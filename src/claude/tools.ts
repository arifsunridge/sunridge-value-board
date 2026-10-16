import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Actor, Board } from "@/board/board";
import { isOverdue, mayChange } from "@/board/board";
import {
  DEPARTMENTS,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  NOTE_MAX_CHARS,
  OWNER_NAMES_MAX,
  PHASES,
  PHASE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_RULE,
  STATUSES,
  STATUS_LABELS,
  NOW_CAP,
  TITLE_MAX_WORDS,
  departmentName,
  hasOwner,
  isOpen,
  type Area,
  type Company,
  type DepartmentId,
  type Document,
  type Person,
  type Project,
  type Task,
} from "@/board/model";
import { People } from "@/board/people";
import { BoardError } from "@/board/rules";
import { describe as describeEntry } from "@/ui/format";

// Claude's door to the board (spec P1.1). Every tool calls Board, so the rules on
// screen apply here unchanged, and every change is on the Trail as "via Claude".

const INSTRUCTIONS = `This is the Sunridge Value Board: the Value Creation and Investment team's Tasks for each portfolio company and for Sunridge itself. You act as the signed-in Member; every change you make is recorded in the Task's Trail as made via Claude.

Words: a Company has six Departments (${DEPARTMENTS.map((d) => d.name).join(", ")}); an Area is a slice of one Department in one Company. A Task lives in one Company and Department, and at most one Area. A Project groups Tasks in one such place, with a goal, an Owner, a Phase (Idea, Building, Live or Paused) and Updates (dated lines of news); its Progress is its Done Tasks out of all its Tasks. Status is Next, Now, Blocked or Done. Owners are accountable; they are people on the board, or names typed for anyone else (owner_names), and a Task may have no Owner yet. Contributors help; anyone else is a Viewer. You may change a Task you own or contribute to, or any Task none of whose Owners has signed in yet; otherwise join it first. The company owner is who answers for a Task at the portfolio company, by name. A Private Task is seen only by its Owners and Contributors, never by other Members or a company team; never mention one to anyone who isn't on it.

Rules the board enforces: titles have at most ${TITLE_MAX_WORDS} words and start with a verb, with no people's names; each Company has at most ${NOW_CAP} Tasks in Now; moving a Task to Blocked needs a one-line "waiting on". Priority uses the one-week slip test: High = ${PRIORITY_RULE.high} Medium = ${PRIORITY_RULE.medium} Low = ${PRIORITY_RULE.low} High should be rare.

When someone says they finished something and shares a file or link, find the Task, propose marking it Done with that evidence (mark_done_with_evidence) and, if it is part of a Project, an Update; then do it once they agree. Files live in the team board's file store; link to them here.

Before changing anything, confirm the change with the person unless they asked for it explicitly. Never invent Tasks, figures or owners.`;

class NotFound extends Error {}

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function refused(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Runs a tool, turning broken rules into messages Claude can act on. Never logs board content. */
async function attempt(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof BoardError || error instanceof NotFound) return refused(error.message);
    console.error("Claude tool failed:", error instanceof Error ? error.name : "unknown");
    return refused("The board couldn't complete that. Try again in a moment.");
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Lookups that accept what a person would say: names as well as IDs. */
class Lookup {
  readonly people: People;

  private constructor(
    readonly members: Person[],
    readonly companies: Company[],
    private readonly areas: Map<string, Area[]>,
    private readonly projects: Map<string, Project[]>,
    private readonly actor: Actor,
  ) {
    this.people = new People(members);
  }

  static async load(board: Board, actor: Actor): Promise<Lookup> {
    const [members, companies] = await Promise.all([board.people(actor), board.companies(actor)]);
    const areas = new Map<string, Area[]>();
    const projects = new Map<string, Project[]>();
    await Promise.all(
      companies.map(async (c) => {
        const view = await board.board(actor, c.id);
        areas.set(c.id, view.areas);
        projects.set(c.id, view.projects.map((p) => p.project));
      }),
    );
    return new Lookup(members, companies, areas, projects, actor);
  }

  project(companyId: string, input: string): Project {
    const list = this.projects.get(companyId) ?? [];
    const found = list.find((p) => p.id === input || same(p.name, input));
    if (!found) throw new NotFound(`No Project called "${input}" in this company. Projects: ${list.map((p) => p.name).join(", ") || "none yet"}.`);
    return found;
  }

  projectAnywhere(input: string): Project {
    for (const list of this.projects.values()) {
      const found = list.find((p) => p.id === input || same(p.name, input));
      if (found) return found;
    }
    throw new NotFound(`No Project called "${input}". Use list_projects to see them.`);
  }

  projectName(id: string | null): string | null {
    if (!id) return null;
    for (const list of this.projects.values()) {
      const found = list.find((p) => p.id === id);
      if (found) return found.name;
    }
    return null;
  }

  company(input: string): Company {
    const found = this.companies.find((c) => c.id === input || same(c.name, input));
    if (!found) throw new NotFound(`No company called "${input}". Companies: ${this.companies.map((c) => c.name).join(", ")}.`);
    return found;
  }

  department(input: string): DepartmentId {
    const found = DEPARTMENTS.find((d) => d.id === input || same(d.name, input));
    if (!found) throw new NotFound(`No Department called "${input}". Departments: ${DEPARTMENTS.map((d) => d.name).join(", ")}.`);
    return found.id;
  }

  area(companyId: string, input: string): Area {
    const areas = this.areas.get(companyId) ?? [];
    const found = areas.find((a) => a.id === input || same(a.name, input));
    if (!found) {
      throw new NotFound(`No Area called "${input}" in this company. Areas: ${areas.map((a) => `${departmentName(a.departmentId)} › ${a.name}`).join(", ") || "none yet"}.`);
    }
    return found;
  }

  get me(): Person | undefined {
    return this.people.get(this.actor.memberId);
  }

  projectView(p: Project, progress?: { done: number; total: number }) {
    return {
      id: p.id,
      name: p.name,
      company: this.companies.find((c) => c.id === p.companyId)?.name ?? p.companyId,
      department: departmentName(p.departmentId),
      area: this.areaName(p.areaId),
      goal: p.goal || null,
      owner: p.ownerId ? this.people.name(p.ownerId) : p.ownerName || null,
      phase: p.phase ? PHASE_LABELS[p.phase] : null,
      ...(p.repository ? { repository: p.repository } : {}),
      ...(p.portalApp ? { portal_app: p.portalApp } : {}),
      ...(p.liveUrl ? { live_address: p.liveUrl } : {}),
      ...(progress ? { progress: `${progress.done} of ${progress.total} Tasks done` } : {}),
    };
  }

  areaName(id: string | null): string | null {
    if (!id) return null;
    for (const list of this.areas.values()) {
      const area = list.find((a) => a.id === id);
      if (area) return area.name;
    }
    return null;
  }

  /** "me", a person's ID, an email address, a full name, or a first name only one person has. */
  person(input: string): string {
    try {
      return this.people.resolve(input, this.actor.memberId);
    } catch (error) {
      throw new NotFound(error instanceof Error ? error.message : String(error));
    }
  }

  names(ids: string[]): string[] {
    return this.people.names(ids);
  }

  task(t: Task, today: string) {
    return {
      id: t.id,
      title: t.title,
      company: this.companies.find((c) => c.id === t.companyId)?.name ?? t.companyId,
      department: departmentName(t.departmentId),
      area: this.areaName(t.areaId),
      status: STATUS_LABELS[t.status],
      priority: PRIORITY_LABELS[t.priority],
      project: this.projectName(t.projectId),
      owners: this.people.ownerNames(t),
      ...(hasOwner(t) ? {} : { needs_an_owner: true }),
      ...(t.companyOwner ? { company_owner: t.companyOwner } : {}),
      contributors: this.names(t.contributorIds),
      due: t.due,
      overdue: isOverdue(t, today),
      ...(t.status === "blocked" ? { waiting_on: t.note } : { note: t.note || null }),
      shared_with_company_team: t.shared,
      ...(t.private ? { private: true } : {}),
      you_can_change_it: this.me ? mayChange(this.me, t, this.people) : false,
      ...(t.removed ? { removed: true } : {}),
    };
  }
}

function documentView(d: Document) {
  return { id: d.id, name: d.name, kind: d.kind === "claude" ? "Claude work" : d.kind === "file" ? "File" : "Link", status: DOCUMENT_STATUS_LABELS[d.status], url: d.url, ...(d.removed ? { removed: true } : {}) };
}

const statusSchema = z.enum(STATUSES).describe("next, now, blocked or done");
const prioritySchema = z.enum(PRIORITIES).describe(`high: ${PRIORITY_RULE.high} medium: ${PRIORITY_RULE.medium} low: ${PRIORITY_RULE.low}`);
const peopleSchema = z.array(z.string()).describe('People on the board by full name, unique first name, email, or "me".');
const ownerNamesSchema = z
  .array(z.string().max(80))
  .max(OWNER_NAMES_MAX)
  .describe("Owners who aren't on the board, by name, such as a colleague who hasn't signed in yet.");
const phaseSchema = z.enum(PHASES).describe("idea, building, live or paused");
const titleSchema = z.string().describe(`At most ${TITLE_MAX_WORDS} words, starting with a verb. No people's names.`);
const dueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("YYYY-MM-DD, or null for no date.");
const noteSchema = z.string().max(NOTE_MAX_CHARS).describe("At most two short lines.");

/** One MCP server per request, bound to the Member the access token speaks for. */
export function boardServer(board: Board, actor: Actor): McpServer {
  const server = new McpServer({ name: "sunridge-value-board", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const lookup = () => Lookup.load(board, actor);
  const read = { readOnlyHint: true, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  // ---------- reading ----------

  server.registerTool(
    "list_companies",
    { title: "List companies", description: "The companies on the board, with their Areas.", annotations: read },
    () =>
      attempt(async () => {
        const l = await lookup();
        return Promise.all(
          l.companies.map(async (c) => ({
            id: c.id,
            name: c.name,
            areas: (await board.board(actor, c.id)).areas.map((a) => `${departmentName(a.departmentId)} › ${a.name}`),
          })),
        );
      }),
  );

  server.registerTool(
    "list_members",
    {
      title: "List people",
      description: "The people on the board who can own or contribute to Tasks, including Sunridge colleagues who haven't signed in yet.",
      annotations: read,
    },
    () =>
      attempt(async () =>
        (await board.people(actor)).map((m) => ({
          name: m.name,
          email: m.email,
          sunridge: m.kind === "member",
          signed_in: Boolean(m.signedInAt),
          is_you: m.id === actor.memberId,
        })),
      ),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description: "Tasks for one company, highest Priority first. Done Tasks are left out unless asked for.",
      inputSchema: {
        company: z.string().describe("Company name or ID."),
        status: statusSchema.optional(),
        priority: z.enum(PRIORITIES).optional(),
        person: z.string().optional().describe('Only Tasks this person owns or contributes to. "me" works.'),
        project: z.string().optional().describe("Only Tasks in this Project (name or ID)."),
        needs_an_owner: z.boolean().optional().describe("Only Tasks with no Owner."),
        overdue_only: z.boolean().optional(),
        include_done: z.boolean().optional(),
      },
      annotations: read,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const company = l.company(args.company);
        const person = args.person ? l.person(args.person) : null;
        const project = args.project ? l.project(company.id, args.project) : null;
        const today = board.today();
        const view = await board.board(actor, company.id);
        return view.tasks
          .filter((t) => (args.status ? t.status === args.status : args.include_done || t.status !== "done"))
          .filter((t) => !args.priority || t.priority === args.priority)
          .filter((t) => !person || t.ownerIds.includes(person) || t.contributorIds.includes(person))
          .filter((t) => !project || t.projectId === project.id)
          .filter((t) => !args.needs_an_owner || !hasOwner(t))
          .filter((t) => !args.overdue_only || isOverdue(t, today))
          .map((t) => l.task(t, today));
      }),
  );

  server.registerTool(
    "my_tasks",
    { title: "My Tasks", description: "Open Tasks the signed-in Member owns or contributes to, across every company.", annotations: read },
    () =>
      attempt(async () => {
        const l = await lookup();
        const today = board.today();
        return (await board.myTasks(actor)).filter(isOpen).map((t) => l.task(t, today));
      }),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get a Task",
      description: "One Task with its Documents and its Trail (who changed what, and when).",
      inputSchema: { task_id: z.string() },
      annotations: read,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const { task, documents, trail } = await board.task(actor, args.task_id);
        const names = Object.fromEntries(l.companies.map((c) => [c.id, c.name]));
        return {
          ...l.task(task, board.today()),
          documents: documents.map(documentView),
          trail: trail.map((e) => ({ at: e.at, what: describeEntry(e, l.members, names) })),
        };
      }),
  );

  server.registerTool(
    "company_summary",
    {
      title: "Company summary",
      description:
        "The Partner view of one company: Blocked and High Tasks, overdue Tasks, and what changed in the last 7 days. The signed-in Member's own Private Tasks come separately, for them only.",
      inputSchema: { company: z.string().describe("Company name or ID.") },
      annotations: read,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const s = await board.summary(actor, l.company(args.company).id);
        const today = board.today();
        return {
          company: s.company.name,
          needs_attention: s.attention.map((t) => l.task(t, today)),
          overdue: s.overdue.map((t) => l.task(t, today)),
          changed_this_week: s.changes.map((c) => ({ task: c.task.title, id: c.task.id, changes: c.events })),
          other_open_tasks: s.rest.length,
          ...(s.private.length ? { your_private_tasks: s.private.map((t) => l.task(t, today)) } : {}),
        };
      }),
  );

  // ---------- changing ----------

  server.registerTool(
    "create_task",
    {
      title: "Add a Task",
      description: "Add a Task to a company's board. It starts in Next unless a status is given.",
      inputSchema: {
        company: z.string().describe("Company name or ID."),
        department: z.string().describe(`One of: ${DEPARTMENTS.map((d) => d.name).join(", ")}.`),
        area: z.string().optional().describe("Area name in that company, if the work belongs to one."),
        project: z.string().optional().describe("Project name or ID in that company. The Task then lives where the Project lives."),
        title: titleSchema,
        priority: prioritySchema,
        owners: peopleSchema.optional(),
        owner_names: ownerNamesSchema.optional(),
        company_owner: z.string().max(120).optional().describe("Who answers for it at the portfolio company, by name."),
        contributors: peopleSchema.optional(),
        due: dueSchema.optional(),
        note: noteSchema.optional(),
        status: statusSchema.optional(),
        waiting_on: z.string().optional().describe("Required when status is blocked."),
        private: z.boolean().optional().describe("Only its Owners and Contributors will see it. The signed-in Member must be one of them."),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const company = l.company(args.company);
        const area = args.area ? l.area(company.id, args.area) : null;
        const project = args.project ? l.project(company.id, args.project) : null;
        const task = await board.createTask(actor, {
          companyId: company.id,
          departmentId: area?.departmentId ?? l.department(args.department),
          areaId: area?.id ?? null,
          projectId: project?.id ?? null,
          title: args.title,
          priority: args.priority,
          status: args.status,
          ownerIds: (args.owners ?? []).map((p) => l.person(p)),
          ownerNames: args.owner_names,
          companyOwner: args.company_owner,
          contributorIds: (args.contributors ?? []).map((p) => l.person(p)),
          due: args.due ?? null,
          note: args.status === "blocked" ? args.waiting_on : args.note,
          private: args.private,
        });
        return l.task(task, board.today());
      }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Change a Task",
      description:
        "Change a Task's title, Priority, Owners, company owner, Project, Contributors, due date or note. Only fields you pass change. Putting it in a Project moves it to the Project's place; project \"none\" takes it out.",
      inputSchema: {
        task_id: z.string(),
        title: titleSchema.optional(),
        priority: prioritySchema.optional(),
        owners: peopleSchema.optional(),
        owner_names: ownerNamesSchema.optional(),
        company_owner: z.string().max(120).optional(),
        project: z.string().optional().describe('Project name or ID, or "none".'),
        contributors: peopleSchema.optional(),
        due: dueSchema.optional(),
        note: noteSchema.optional(),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const { task: current } = await board.task(actor, args.task_id);
        const projectId = args.project === undefined ? undefined : same(args.project, "none") ? null : l.project(current.companyId, args.project).id;
        const task = await board.updateTask(actor, args.task_id, {
          title: args.title,
          priority: args.priority,
          ownerIds: args.owners?.map((p) => l.person(p)),
          ownerNames: args.owner_names,
          companyOwner: args.company_owner,
          projectId,
          contributorIds: args.contributors?.map((p) => l.person(p)),
          due: args.due,
          note: args.note,
        });
        return l.task(task, board.today());
      }),
  );

  server.registerTool(
    "move_task",
    {
      title: "Move a Task",
      description: `Change a Task's Status, and optionally its Department or Area within the same company. Moving to Now is refused when the company already has ${NOW_CAP} Tasks in Now. Moving to Blocked needs waiting_on.`,
      inputSchema: {
        task_id: z.string(),
        status: statusSchema,
        waiting_on: z.string().optional().describe("Who or what the Task is waiting on, in one line. Required when moving to blocked."),
        department: z.string().optional(),
        area: z.string().optional().describe('Area name, or "none" for the whole Department.'),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const { task: current } = await board.task(actor, args.task_id);
        let home: { departmentId?: string; areaId?: string | null } = {};
        if (args.area && !same(args.area, "none")) {
          const area = l.area(current.companyId, args.area);
          home = { departmentId: area.departmentId, areaId: area.id };
        } else if (args.department || args.area) {
          home = { departmentId: args.department ? l.department(args.department) : current.departmentId, areaId: null };
        }
        const task = await board.moveTask(actor, args.task_id, { status: args.status, waitingOn: args.waiting_on, ...home });
        return l.task(task, board.today());
      }),
  );

  for (const [name, title, description, run] of [
    ["join_task", "Join a Task", "Join a Task as a Contributor, so you can change it. Recorded on the Trail.", board.joinTask.bind(board)],
    ["remove_task", "Remove a Task", "Take a Task off the board. Its Trail is kept and it can be restored.", board.removeTask.bind(board)],
    ["restore_task", "Restore a Task", "Put a removed Task back on the board.", board.restoreTask.bind(board)],
  ] as const) {
    server.registerTool(name, { title, description, inputSchema: { task_id: z.string() }, annotations: write }, (args) =>
      attempt(async () => {
        const l = await lookup();
        return l.task(await run(actor, args.task_id), board.today());
      }),
    );
  }

  server.registerTool(
    "make_private",
    {
      title: "Make a Task private",
      description:
        "Make a Task private, so only its Owners and Contributors see it, or open it to every Sunridge Member again. The signed-in Member must be on the Task to make it private. A Shared Task must stop being shared first.",
      inputSchema: { task_id: z.string(), private: z.boolean() },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        return l.task(await board.setPrivate(actor, args.task_id, args.private), board.today());
      }),
  );

  server.registerTool(
    "share_task",
    {
      title: "Share a Task with the company team",
      description:
        "Share a Task with its company team (for HBF, the HBF team in the HBF Portal), or stop sharing it. Tasks in Talent & organisation or Finance can never be shared. Stopping takes the company team off the Task. Confirm with the person before sharing.",
      inputSchema: { task_id: z.string(), shared: z.boolean() },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        return l.task(await board.shareTask(actor, args.task_id, args.shared), board.today());
      }),
  );

  server.registerTool(
    "add_document_link",
    {
      title: "Add a Document link",
      description: "Link a Document to a Task: a SharePoint or web page, or Claude work (for example a claude.ai artifact or chat). Files are uploaded on the board's screen, not here.",
      inputSchema: {
        task_id: z.string(),
        name: z.string().max(120),
        url: z.string().describe("https:// address"),
        kind: z.enum(["link", "claude"]).optional().describe('"claude" for Claude work; "link" otherwise.'),
        status: z.enum(DOCUMENT_STATUSES).optional(),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () =>
        documentView(await board.addDocument(actor, args.task_id, { kind: args.kind ?? "link", name: args.name, url: args.url, status: args.status })),
      ),
  );

  server.registerTool(
    "update_document",
    {
      title: "Change a Document",
      description: "Change a Document's name or status (draft, in_review, final).",
      inputSchema: { document_id: z.string(), name: z.string().max(120).optional(), status: z.enum(DOCUMENT_STATUSES).optional() },
      annotations: write,
    },
    (args) => attempt(async () => documentView(await board.updateDocument(actor, args.document_id, { name: args.name, status: args.status }))),
  );

  // ---------- Projects ----------

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "The Projects in one company, or in every company, with their Phase, Owner and Progress.",
      inputSchema: { company: z.string().optional().describe("Company name or ID. Leave out for every company.") },
      annotations: read,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const companies = args.company ? [l.company(args.company)] : l.companies;
        const lists = await Promise.all(companies.map((c) => board.projects(actor, c.id)));
        return lists.flat().map((v) => l.projectView(v.project, v.progress));
      }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get a Project",
      description: "One Project with its Tasks, its Updates (news, oldest first) and its Trail.",
      inputSchema: { project: z.string().describe("Project name or ID.") },
      annotations: read,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const detail = await board.project(actor, l.projectAnywhere(args.project).id);
        const today = board.today();
        const names = Object.fromEntries(l.companies.map((c) => [c.id, c.name]));
        return {
          ...l.projectView(detail.project, detail.progress),
          tasks: detail.tasks.map((t) => l.task(t, today)),
          updates: detail.updates.map((u) => ({ at: u.at, by: u.byName, text: u.text })),
          trail: detail.trail.map((e) => ({ at: e.at, what: describeEntry(e, l.members, names) })),
        };
      }),
  );

  const projectFields = {
    goal: z.string().max(300).optional().describe("What the Project is for, in a sentence or two."),
    owner: z.string().optional().describe('A Sunridge person by name or email, or "me".'),
    owner_name: z.string().max(80).optional().describe("The Owner by name, when they aren't on the board."),
    phase: phaseSchema.optional(),
    repository: z.string().optional().describe("owner/name, or the repository's https address."),
    portal_app: z.string().optional().describe("The app's short name in the HBF Portal, such as site-flow."),
    live_address: z.string().optional().describe("https address where the app runs."),
  };

  server.registerTool(
    "create_project",
    {
      title: "Add a Project",
      description: "Add a Project to a company: a named piece of work that groups Tasks in one Department or Area.",
      inputSchema: {
        company: z.string().describe("Company name or ID."),
        department: z.string().describe(`One of: ${DEPARTMENTS.map((d) => d.name).join(", ")}.`),
        area: z.string().optional().describe("Area name in that company, if the Project belongs to one."),
        name: z.string().max(80),
        ...projectFields,
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const company = l.company(args.company);
        const area = args.area ? l.area(company.id, args.area) : null;
        const project = await board.createProject(actor, {
          companyId: company.id,
          departmentId: area?.departmentId ?? l.department(args.department),
          areaId: area?.id ?? null,
          name: args.name,
          goal: args.goal,
          ownerId: args.owner ? l.person(args.owner) : null,
          ownerName: args.owner_name,
          phase: args.phase ?? null,
          repository: args.repository,
          portalApp: args.portal_app,
          liveUrl: args.live_address,
        });
        return l.projectView(project);
      }),
  );

  server.registerTool(
    "update_project",
    {
      title: "Change a Project",
      description:
        "Change a Project's name, goal, Owner, Phase or app details, or move it to another Department or Area (its Tasks move with it). Only fields you pass change.",
      inputSchema: {
        project: z.string().describe("Project name or ID."),
        name: z.string().max(80).optional(),
        ...projectFields,
        department: z.string().optional(),
        area: z.string().optional().describe('Area name, or "none" for the whole Department.'),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        let project = l.projectAnywhere(args.project);
        if (args.department || args.area) {
          const area = args.area && !same(args.area, "none") ? l.area(project.companyId, args.area) : null;
          project = await board.moveProject(actor, project.id, {
            departmentId: area?.departmentId ?? (args.department ? l.department(args.department) : project.departmentId),
            areaId: area?.id ?? null,
          });
        }
        const owner = args.owner !== undefined || args.owner_name !== undefined;
        project = await board.updateProject(actor, project.id, {
          name: args.name,
          goal: args.goal,
          ...(owner ? { ownerId: args.owner ? l.person(args.owner) : null, ownerName: args.owner_name ?? "" } : {}),
          phase: args.phase,
          repository: args.repository,
          portalApp: args.portal_app,
          liveUrl: args.live_address,
        });
        return l.projectView(project);
      }),
  );

  server.registerTool(
    "add_project_update",
    {
      title: "Add a Project Update",
      description: "Add a dated line of news to a Project, such as what was finished or decided. Updates are never changed or deleted.",
      inputSchema: { project: z.string().describe("Project name or ID."), text: z.string().max(500) },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const update = await board.addProjectUpdate(actor, l.projectAnywhere(args.project).id, { text: args.text });
        return { at: update.at, by: update.byName, text: update.text };
      }),
  );

  server.registerTool(
    "set_task_owners",
    {
      title: "Set a Task's Owners",
      description:
        "Replace a Task's Owners: people on the board, and names typed for anyone else. Pass both empty to leave it with no Owner.",
      inputSchema: { task_id: z.string(), owners: peopleSchema, owner_names: ownerNamesSchema.optional() },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const task = await board.updateTask(actor, args.task_id, { ownerIds: args.owners.map((p) => l.person(p)), ownerNames: args.owner_names ?? [] });
        return l.task(task, board.today());
      }),
  );

  server.registerTool(
    "mark_done_with_evidence",
    {
      title: "Mark a Task Done, with its evidence",
      description:
        "Add the evidence (a link to the file in the team board's file store, a web page, or Claude work) and move the Task to Done. Optionally add an Update to its Project. Confirm with the person first.",
      inputSchema: {
        task_id: z.string(),
        evidence_name: z.string().max(120),
        evidence_url: z.string().describe("https:// address"),
        kind: z.enum(["link", "claude"]).optional().describe('"claude" for Claude work; "link" otherwise.'),
        project_update: z.string().max(500).optional().describe("A line of news for the Task's Project, if it has one."),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const { task, document } = await board.finishTask(actor, args.task_id, {
          kind: args.kind ?? "link",
          name: args.evidence_name,
          url: args.evidence_url,
          status: "final",
        });
        const update = args.project_update && task.projectId ? await board.addProjectUpdate(actor, task.projectId, { text: args.project_update }) : null;
        return { task: l.task(task, board.today()), document: documentView(document), ...(update ? { project_update: update.text } : {}) };
      }),
  );

  return server;
}
