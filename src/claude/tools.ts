import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Actor, Board } from "@/board/board";
import { isOverdue } from "@/board/board";
import {
  DEPARTMENTS,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  NOTE_MAX_CHARS,
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_RULE,
  STATUSES,
  STATUS_LABELS,
  TITLE_MAX_WORDS,
  departmentName,
  isOpen,
  type Area,
  type Company,
  type DepartmentId,
  type Document,
  type Member,
  type Task,
} from "@/board/model";
import { BoardError } from "@/board/rules";
import { describe as describeEntry } from "@/ui/format";

// Claude's door to the board (spec P1.1). Every tool calls Board, so the rules on
// screen apply here unchanged, and every change is on the Trail as "via Claude".

const INSTRUCTIONS = `This is the Sunridge Value Board: the Value Creation and Investment team's Tasks for each portfolio company and for Sunridge itself. You act as the signed-in Member; every change you make is recorded in the Task's Trail as made via Claude.

Words: a Company has six Departments (${DEPARTMENTS.map((d) => d.name).join(", ")}); an Area is a slice of one Department in one Company. A Task lives in one Company and Department, and at most one Area. Status is Next, Now, Blocked or Done. Owners are accountable; Contributors help; anyone else is a Viewer and cannot change the Task until they join it.

Rules the board enforces: titles have at most ${TITLE_MAX_WORDS} words and start with a verb, with no people's names; every Task has at least one Owner; each Company has at most 5 Tasks in Now; moving a Task to Blocked needs a one-line "waiting on". Priority uses the one-week slip test: High = ${PRIORITY_RULE.high} Medium = ${PRIORITY_RULE.medium} Low = ${PRIORITY_RULE.low} High should be rare.

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
  private constructor(
    readonly members: Member[],
    readonly companies: Company[],
    private readonly areas: Map<string, Area[]>,
    private readonly actor: Actor,
  ) {}

  static async load(board: Board, actor: Actor): Promise<Lookup> {
    const [members, companies] = await Promise.all([board.members(), board.companies()]);
    const areas = new Map<string, Area[]>();
    await Promise.all(companies.map(async (c) => areas.set(c.id, (await board.board(c.id)).areas)));
    return new Lookup(members, companies, areas, actor);
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

  areaName(id: string | null): string | null {
    if (!id) return null;
    for (const list of this.areas.values()) {
      const area = list.find((a) => a.id === id);
      if (area) return area.name;
    }
    return null;
  }

  /** "me", a Member ID, an email address, a full name, or a first name that only one Member has. */
  person(input: string): string {
    if (same(input, "me")) return this.actor.memberId;
    const exact = this.members.find((m) => m.id === input || same(m.email, input) || same(m.name, input));
    if (exact) return exact.id;
    const byFirst = this.members.filter((m) => same(m.name.split(/\s+/)[0] ?? "", input));
    if (byFirst.length === 1) return byFirst[0]!.id;
    const names = this.members.map((m) => m.name).join(", ");
    throw new NotFound(
      byFirst.length > 1 ? `"${input}" matches more than one Member. Use a full name: ${names}.` : `"${input}" isn't a Sunridge Member. Members: ${names}.`,
    );
  }

  names(ids: string[]): string[] {
    return ids.map((id) => this.members.find((m) => m.id === id)?.name ?? "Former member");
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
      owners: this.names(t.ownerIds),
      contributors: this.names(t.contributorIds),
      due: t.due,
      overdue: isOverdue(t, today),
      ...(t.status === "blocked" ? { waiting_on: t.note } : { note: t.note || null }),
      you_can_change_it: t.ownerIds.includes(this.actor.memberId) || t.contributorIds.includes(this.actor.memberId),
      ...(t.removed ? { removed: true } : {}),
    };
  }
}

function documentView(d: Document) {
  return { id: d.id, name: d.name, kind: d.kind === "claude" ? "Claude work" : d.kind === "file" ? "File" : "Link", status: DOCUMENT_STATUS_LABELS[d.status], url: d.url, ...(d.removed ? { removed: true } : {}) };
}

const statusSchema = z.enum(STATUSES).describe("next, now, blocked or done");
const prioritySchema = z.enum(PRIORITIES).describe(`high: ${PRIORITY_RULE.high} medium: ${PRIORITY_RULE.medium} low: ${PRIORITY_RULE.low}`);
const peopleSchema = z.array(z.string()).describe('Members by full name, unique first name, email, or "me".');
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
            areas: (await board.board(c.id)).areas.map((a) => `${departmentName(a.departmentId)} › ${a.name}`),
          })),
        );
      }),
  );

  server.registerTool(
    "list_members",
    { title: "List Members", description: "The Sunridge Members who can own or contribute to Tasks.", annotations: read },
    () => attempt(async () => (await board.members()).map((m) => ({ name: m.name, email: m.email, is_you: m.id === actor.memberId }))),
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
        person: z.string().optional().describe('Only Tasks this Member owns or contributes to. "me" works.'),
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
        const today = board.today();
        const view = await board.board(company.id);
        return view.tasks
          .filter((t) => (args.status ? t.status === args.status : args.include_done || t.status !== "done"))
          .filter((t) => !args.priority || t.priority === args.priority)
          .filter((t) => !person || t.ownerIds.includes(person) || t.contributorIds.includes(person))
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
        return (await board.myTasks(actor.memberId)).filter(isOpen).map((t) => l.task(t, today));
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
        const { task, documents, trail } = await board.task(args.task_id);
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
      description: "The Partner view of one company: Blocked and High Tasks, overdue Tasks, and what changed in the last 7 days.",
      inputSchema: { company: z.string().describe("Company name or ID.") },
      annotations: read,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const s = await board.summary(l.company(args.company).id);
        const today = board.today();
        return {
          company: s.company.name,
          needs_attention: s.attention.map((t) => l.task(t, today)),
          overdue: s.overdue.map((t) => l.task(t, today)),
          changed_this_week: s.changes.map((c) => ({ task: c.task.title, id: c.task.id, changes: c.events })),
          other_open_tasks: s.rest.length,
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
        title: titleSchema,
        priority: prioritySchema,
        owners: peopleSchema.min(1),
        contributors: peopleSchema.optional(),
        due: dueSchema.optional(),
        note: noteSchema.optional(),
        status: statusSchema.optional(),
        waiting_on: z.string().optional().describe("Required when status is blocked."),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const company = l.company(args.company);
        const area = args.area ? l.area(company.id, args.area) : null;
        const task = await board.createTask(actor, {
          companyId: company.id,
          departmentId: area?.departmentId ?? l.department(args.department),
          areaId: area?.id ?? null,
          title: args.title,
          priority: args.priority,
          status: args.status,
          ownerIds: args.owners.map((p) => l.person(p)),
          contributorIds: (args.contributors ?? []).map((p) => l.person(p)),
          due: args.due ?? null,
          note: args.status === "blocked" ? args.waiting_on : args.note,
        });
        return l.task(task, board.today());
      }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Change a Task",
      description: "Change a Task's title, Priority, Owners, Contributors, due date or note. Only fields you pass change. You must be an Owner or Contributor.",
      inputSchema: {
        task_id: z.string(),
        title: titleSchema.optional(),
        priority: prioritySchema.optional(),
        owners: peopleSchema.min(1).optional(),
        contributors: peopleSchema.optional(),
        due: dueSchema.optional(),
        note: noteSchema.optional(),
      },
      annotations: write,
    },
    (args) =>
      attempt(async () => {
        const l = await lookup();
        const task = await board.updateTask(actor, args.task_id, {
          title: args.title,
          priority: args.priority,
          ownerIds: args.owners?.map((p) => l.person(p)),
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
      description: "Change a Task's Status, and optionally its Department or Area within the same company. Moving to Now is refused when the company already has 5 Tasks in Now. Moving to Blocked needs waiting_on.",
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
        const { task: current } = await board.task(args.task_id);
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

  return server;
}
