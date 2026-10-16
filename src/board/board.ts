import {
  TEAM_BOARD_SOURCE,
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  HIGH_SHARE_WARNING,
  NOW_CAP,
  PHASES,
  PRIORITIES,
  STATUSES,
  STATUS_LABELS,
  UPDATE_MAX_CHARS,
  canBeShared,
  canSee,
  isDepartmentId,
  isMember,
  isOnTask,
  isOpen,
  progress,
  type Area,
  type Company,
  type DepartmentId,
  type Document,
  type DocumentKind,
  type DocumentStatus,
  type Person,
  type Phase,
  type Priority,
  type Project,
  type ProjectUpdate,
  type Status,
  type Task,
  type TrailEntry,
  type Via,
} from "./model";
import { People } from "./people";
import { BoardError, cleanDue, cleanName, cleanNote, cleanTitle, cleanUrl } from "./rules";
import type { Store } from "@/store/store";

/** Who is acting, and through which door (screen, Capture, Claude, import). */
export interface Actor {
  /** The Person's id. Named for the Trail column, which records the Company team too. */
  memberId: string;
  via: Via;
}

/** Who is asking: an Actor, or the signed-in Person. Every read is filtered by them (ADR 0005). */
export type Reader = Pick<Actor, "memberId"> | Pick<Person, "id">;

const readerId = (who: Reader): string => ("memberId" in who ? who.memberId : who.id);

export interface NewTask {
  companyId: string;
  departmentId: string;
  areaId?: string | null;
  title: string;
  priority: Priority;
  status?: Status;
  /** Owners on the board. A Task may start with no Owner (ADR 0009). */
  ownerIds?: string[];
  /** Owners typed by name, for people who aren't on the board. */
  ownerNames?: string[];
  contributorIds?: string[];
  /** Who answers for it at the portfolio company, by name. */
  companyOwner?: string;
  /** The Project it is part of. Its Home then comes from the Project. */
  projectId?: string | null;
  due?: string | null;
  note?: string | null;
  /** Visible to the Company team. Off unless set. */
  shared?: boolean;
  /** Seen only by its Owners and Contributors (ADR 0010). Off unless set; whoever adds it must be on it. */
  private?: boolean;
  /** Where a Task came from, kept in its first Trail entry, e.g. "Meeting notes, 2 Oct". */
  source?: string;
  /** Documents to add with the Task, on its Trail (used by the import). */
  documents?: NewDocument[];
}

export interface TaskChanges {
  title?: string;
  priority?: Priority;
  ownerIds?: string[];
  ownerNames?: string[];
  contributorIds?: string[];
  companyOwner?: string;
  /** Putting a Task in a Project moves it to the Project's Home; null takes it out. */
  projectId?: string | null;
  due?: string | null;
  note?: string;
}

export interface NewProject {
  companyId: string;
  departmentId: string;
  areaId?: string | null;
  name: string;
  goal?: string;
  ownerId?: string | null;
  ownerName?: string;
  phase?: Phase | null;
  repository?: string;
  portalApp?: string;
  liveUrl?: string;
  order?: number;
  /** Where it came from, kept in its first Trail entry, e.g. "Team board (g-…)". */
  source?: string;
}

export type ProjectChanges = Partial<Pick<NewProject, "name" | "goal" | "ownerId" | "ownerName" | "phase" | "repository" | "portalApp" | "liveUrl" | "order">>;

/** A Project with its Progress over the Tasks the asker can see. */
export interface ProjectView {
  project: Project;
  progress: { done: number; total: number };
}

export interface Move {
  status: Status;
  departmentId?: string;
  areaId?: string | null;
  /** Required when moving into Blocked: what the Task is waiting on. Becomes the note. */
  waitingOn?: string;
}

export interface NewDocument {
  kind: DocumentKind;
  name: string;
  url: string;
  status?: DocumentStatus;
  driveItemId?: string | null;
}

export interface BoardView {
  company: Company;
  areas: Area[];
  tasks: Task[];
  documentCounts: Record<string, number>;
  nowCount: number;
  highShare: number;
  tooManyHigh: boolean;
  /** The Projects the asker can see in this Company. */
  projects: ProjectView[];
  /** The Tasks the asker may change (ADR 0009). */
  editable: string[];
}

export interface SummaryChange {
  task: Task;
  events: string[];
}

export interface Summary {
  company: Company;
  attention: Task[];
  overdue: Task[];
  changes: SummaryChange[];
  rest: Task[];
  /** The asker's own open Private Tasks (ADR 0010), kept apart so the rest reads the same for every Member. */
  private: Task[];
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Cards sort by Priority, then due date (undated last), then title. There is no manual ordering. */
export function compareTasks(a: Task, b: Task): number {
  return (
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
    a.title.localeCompare(b.title)
  );
}

export function isOverdue(task: Task, today: string): boolean {
  return isOpen(task) && task.due !== null && task.due < today;
}

/**
 * Every board operation. The screen, Capture, the prototype import and Claude (P1)
 * all go through here, so each rule exists once.
 */
export class Board {
  constructor(
    private readonly store: Store,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  // ---------- reading ----------

  /** Everyone the asker may see on the board: Members, plus the asker's own Company team. */
  async people(who: Reader): Promise<Person[]> {
    const me = await this.person(who);
    const all = await this.store.listPeople();
    return all
      .filter((p) => isMember(p) || isMember(me) || p.companyId === me.companyId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The Companies the asker may open. The Company team sees only its own. */
  async companies(who: Reader): Promise<Company[]> {
    const me = await this.person(who);
    const all = await this.store.listCompanies();
    return isMember(me) ? all : all.filter((c) => c.id === me.companyId && c.kind === "portfolio");
  }

  async company(who: Reader, id: string): Promise<Company> {
    const company = (await this.companies(who)).find((c) => c.id === id);
    if (!company) throw new BoardError("not_found", "That company isn't on the board.");
    return company;
  }

  /** Local sign-in only (AUTH_MODE=dev, refused in production): everyone, to choose who you are. */
  async peopleForLocalSignIn(): Promise<Person[]> {
    return (await this.store.listPeople()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The signed-in Person, as the board knows them. */
  async me(who: Reader): Promise<Person> {
    return this.person(who);
  }

  today(): string {
    return this.clock().toISOString().slice(0, 10);
  }

  async board(who: Reader, companyId: string): Promise<BoardView> {
    const me = await this.person(who);
    const company = await this.company(who, companyId);
    const [allAreas, all] = await Promise.all([this.store.listAreas(companyId), this.store.listTasks({ companyId })]);
    const tasks = all.filter((t) => !t.removed && canSee(me, t)).sort(compareTasks);
    const documents = await this.store.listDocuments({ taskIds: tasks.map((t) => t.id) });
    const documentCounts: Record<string, number> = {};
    for (const d of documents) if (!d.removed) documentCounts[d.taskId] = (documentCounts[d.taskId] ?? 0) + 1;
    const open = tasks.filter(isOpen);
    const highShare = open.length ? open.filter((t) => t.priority === "high").length / open.length : 0;
    // The Company team sees only the Areas that hold a Task shared with them; Area names can be sensitive too.
    const usedAreas = new Set(tasks.map((t) => t.areaId));
    const areas = allAreas.filter((a) => !a.retired && (isMember(me) || usedAreas.has(a.id)));
    const people = await this.directory();
    return {
      company,
      areas: areas.sort((a, b) => a.name.localeCompare(b.name)),
      tasks,
      documentCounts,
      nowCount: tasks.filter(countsForNow).length,
      highShare,
      tooManyHigh: highShare > HIGH_SHARE_WARNING,
      projects: this.projectViews(me, await this.store.listProjects({ companyId }), tasks),
      editable: tasks.filter((t) => mayChange(me, t, people)).map((t) => t.id),
    };
  }

  async task(who: Reader, id: string): Promise<{ task: Task; documents: Document[]; trail: TrailEntry[] }> {
    const task = await this.requireVisible(who, id);
    const [documents, trail] = await Promise.all([
      this.store.listDocuments({ taskIds: [id] }),
      this.store.listTrail({ taskId: id }),
    ]);
    return { task, documents, trail: visibleTrail(trail) };
  }

  async document(who: Reader, id: string): Promise<Document> {
    const doc = await this.store.getDocument(id);
    if (!doc) throw new BoardError("not_found", "That Document isn't on the board.");
    await this.requireVisible(who, doc.taskId).catch(() => {
      throw new BoardError("not_found", "That Document isn't on the board.");
    });
    return doc;
  }

  /** Throws unless the actor may change this Task. Used before side effects outside the board, such as uploads. */
  async checkCanEdit(actor: Actor, taskId: string): Promise<Task> {
    return this.requireEditable(actor, taskId);
  }

  /** Tasks the asker owns or contributes to, across every Company they can see. */
  async myTasks(who: Reader): Promise<Task[]> {
    const me = await this.person(who);
    const tasks = await this.store.listTasks({});
    return tasks
      .filter((t) => !t.removed && canSee(me, t) && (t.ownerIds.includes(me.id) || t.contributorIds.includes(me.id)))
      .sort(compareTasks);
  }

  /**
   * Team board ids to the Tasks that came from them, read from each Task's first Trail entry (ADR 0007),
   * and the ids of Private Tasks, which never go to the team board (ADR 0010).
   * Members only: the sync runs as a Member.
   */
  async teamBoardLinks(
    who: Reader,
  ): Promise<{ tasks: Map<string, string>; projects: Map<string, string>; ownersFromSync: Set<string>; setOnBoard: Set<string>; privateTasks: Set<string> }> {
    await this.requireMember(who, "sync with the team board");
    const tasks = new Map<string, string>();
    const projects = new Map<string, string>();
    // Tasks whose Owners only the sync ever set: before ADR 0009 it stood in as Owner for people it couldn't place.
    const ownersFromSync = new Set<string>();
    const ownersByPeople = new Set<string>();
    // "taskId:field" for the fields this release added, once anything has set them on the board.
    const setOnBoard = new Set<string>();
    for (const company of await this.store.listCompanies()) {
      for (const e of await this.store.listTrail({ companyId: company.id })) {
        const match = e.action === "created" ? e.old?.match(TEAM_BOARD_SOURCE) : null;
        if (match && e.subject === "task" && e.taskId) tasks.set(match[1]!, e.taskId);
        if (match && e.subject === "task" && e.taskId && e.via === "sync") ownersFromSync.add(e.taskId);
        if (match && e.subject === "project") projects.set(match[1]!, e.subjectId);
        if (e.subject === "task" && e.taskId && (e.field === "ownerIds" || e.field === "ownerNames") && e.via !== "sync") ownersByPeople.add(e.taskId);
        if (e.subject === "task" && e.taskId && (e.field === "projectId" || e.field === "companyOwner" || e.field === "ownerNames")) {
          setOnBoard.add(`${e.taskId}:${e.field}`);
        }
      }
    }
    for (const id of ownersByPeople) ownersFromSync.delete(id);
    // Ids only, so the sync keeps Private Tasks off the team board even when the syncing Member isn't on them (ADR 0010).
    const privateTasks = new Set((await this.store.listTasks({})).filter((t) => t.private).map((t) => t.id));
    return { tasks, projects, ownersFromSync, setOnBoard, privateTasks };
  }

  /** Every Project in a Company, removed ones too, with every Update. Members only: the sync reads it. */
  async allProjects(who: Reader, companyId: string): Promise<{ projects: Project[]; updates: ProjectUpdate[] }> {
    await this.requireMember(who, "read every Project");
    const [projects, updates] = await Promise.all([this.store.listProjects({ companyId }), this.store.listProjectUpdates({ companyId })]);
    return { projects, updates };
  }

  async removedTasks(who: Reader, companyId: string): Promise<Task[]> {
    const me = await this.requireMember(who, "see removed Tasks");
    const tasks = await this.store.listTasks({ companyId });
    return tasks.filter((t) => t.removed && canSee(me, t)).sort(compareTasks);
  }

  /**
   * The Partner view: what needs attention, what's late, and what changed in the last week. Private
   * Tasks are listed on their own, for the people on them only (ADR 0010).
   */
  async summary(who: Reader, companyId: string, days = 7): Promise<Summary> {
    const me = await this.person(who);
    const company = await this.company(who, companyId);
    const today = this.today();
    const since = new Date(this.clock().getTime() - days * 86_400_000).toISOString();
    const [all, trail] = await Promise.all([
      this.store.listTasks({ companyId }),
      this.store.listTrail({ companyId, since }),
    ]);
    const visible = all.filter((t) => !t.removed && canSee(me, t)).sort(compareTasks);
    const tasks = visible.filter((t) => !t.private);
    const seen = new Set(tasks.map((t) => t.id));
    const open = tasks.filter(isOpen);
    const attention = open.filter((t) => t.priority === "high" || t.status === "blocked");
    attention.sort((a, b) => Number(b.status === "blocked") - Number(a.status === "blocked") || compareTasks(a, b));
    const overdue = open.filter((t) => isOverdue(t, today));

    const byTask = new Map<string, string[]>();
    for (const entry of visibleTrail(trail)) {
      const label = describeChange(entry);
      if (!label || !entry.taskId || !seen.has(entry.taskId)) continue;
      const events = byTask.get(entry.taskId) ?? [];
      if (!events.includes(label)) events.push(label);
      byTask.set(entry.taskId, events);
    }
    const changes = tasks
      .filter((t) => byTask.has(t.id))
      .map((task) => ({ task, events: byTask.get(task.id)! }));

    const shown = new Set([...attention, ...overdue].map((t) => t.id));
    return {
      company,
      attention,
      overdue,
      changes,
      rest: open.filter((t) => !shown.has(t.id)),
      private: visible.filter((t) => t.private && isOpen(t)),
    };
  }

  // ---------- Tasks ----------

  async createTask(actor: Actor, input: NewTask): Promise<Task> {
    await this.requireMember(actor, "add Tasks");
    await this.company(actor, input.companyId);
    const project = input.projectId ? await this.requireProjectIn(input.companyId, input.projectId) : null;
    const home = project
      ? { departmentId: project.departmentId, areaId: project.areaId }
      : await this.home(input.companyId, input.departmentId, input.areaId ?? null);
    const shared = input.shared ?? false;
    const isPrivate = input.private ?? false;
    if (shared && !canBeShared(home.departmentId)) throw cannotShare();
    if (shared && isPrivate) throw privateNotShared();
    const { ownerIds, ownerNames, contributorIds } = await this.checkOwners(
      { companyId: input.companyId, shared, private: isPrivate },
      input.ownerIds ?? [],
      input.ownerNames ?? [],
      input.contributorIds ?? [],
    );
    if (isPrivate && !isOnTask({ id: actor.memberId }, { ownerIds, contributorIds })) {
      throw new BoardError("invalid", "Keep yourself as an Owner or Contributor on a Private Task, so you can still see it.");
    }
    if (!PRIORITIES.includes(input.priority)) throw new BoardError("invalid", "Choose High, Medium or Low.");
    const status = input.status ?? "next";
    checkStatus(status);
    const note = cleanNote(input.note);
    if (status === "blocked" && !note) {
      throw new BoardError("waiting_on_required", "Say what this Task is waiting on.");
    }
    if (status === "now" && !isPrivate) await this.checkNowCap(input.companyId, null);

    const now = this.clock().toISOString();
    const task: Task = {
      id: this.newId(),
      companyId: input.companyId,
      ...home,
      title: cleanTitle(input.title),
      status,
      priority: input.priority,
      ownerIds,
      ownerNames,
      contributorIds,
      companyOwner: cleanCompanyOwner(input.companyOwner),
      projectId: project?.id ?? null,
      due: cleanDue(input.due),
      note,
      shared,
      private: isPrivate,
      removed: false,
      leverId: null,
      createdAt: now,
      createdBy: actor.memberId,
      updatedAt: now,
    };
    // Every Document is checked before anything is written.
    const documents = (input.documents ?? []).map((d) => this.newDocument(task, d, actor));
    await this.commit(
      [this.entry(actor, task, "task", task.id, "created", null, input.source?.slice(0, 120) ?? null, task.title)],
      () => this.store.putTask(task),
    );
    for (const doc of documents) {
      await this.commit([this.entry(actor, task, "document", doc.id, "added", null, null, doc.name)], () => this.store.putDocument(doc));
    }
    return task;
  }

  async updateTask(actor: Actor, id: string, changes: TaskChanges): Promise<Task> {
    const before = await this.requireEditable(actor, id);
    const after: Task = { ...before };
    const me = await this.person(actor);
    const peopleOrProject = [changes.ownerIds, changes.ownerNames, changes.contributorIds, changes.companyOwner, changes.projectId];
    if (!isMember(me) && (changes.priority !== undefined || peopleOrProject.some((c) => c !== undefined))) {
      throw new BoardError("not_allowed", "Only Sunridge can change the Priority, Owners, Contributors and Project.");
    }

    if (changes.title !== undefined) after.title = cleanTitle(changes.title);
    if (changes.priority !== undefined) {
      if (!PRIORITIES.includes(changes.priority)) throw new BoardError("invalid", "Choose High, Medium or Low.");
      after.priority = changes.priority;
    }
    if (changes.ownerIds !== undefined || changes.ownerNames !== undefined || changes.contributorIds !== undefined) {
      Object.assign(
        after,
        await this.checkOwners(
          after,
          changes.ownerIds ?? after.ownerIds,
          changes.ownerNames ?? after.ownerNames,
          changes.contributorIds ?? after.contributorIds,
        ),
      );
    }
    if (changes.companyOwner !== undefined) after.companyOwner = cleanCompanyOwner(changes.companyOwner);
    if (changes.projectId !== undefined && changes.projectId !== before.projectId) {
      if (changes.projectId === null) after.projectId = null;
      else {
        const project = await this.requireProjectIn(before.companyId, changes.projectId);
        Object.assign(after, { projectId: project.id, departmentId: project.departmentId, areaId: project.areaId });
      }
    }
    if (changes.due !== undefined) after.due = cleanDue(changes.due);
    if (changes.note !== undefined) {
      after.note = cleanNote(changes.note);
      if (after.status === "blocked" && !after.note) {
        throw new BoardError("waiting_on_required", "A Blocked Task must say what it is waiting on.");
      }
    }
    return this.save(actor, before, after);
  }

  /** Change Status, and optionally the Department or Area, within the same Company. */
  async moveTask(actor: Actor, id: string, move: Move): Promise<Task> {
    checkStatus(move.status);
    const before = await this.requireEditable(actor, id);
    const after: Task = { ...before, status: move.status };
    if (move.departmentId !== undefined || move.areaId !== undefined) {
      await this.requireMember(actor, "move a Task to another Department or Area");
      Object.assign(
        after,
        await this.home(before.companyId, move.departmentId ?? before.departmentId, move.areaId ?? null),
      );
      await this.keepProjectIfHomeFits(after);
    }
    if (move.status === "blocked" && before.status !== "blocked") {
      const waitingOn = cleanNote(move.waitingOn);
      if (!waitingOn) throw new BoardError("waiting_on_required", "Say what this Task is waiting on.");
      after.note = waitingOn;
    }
    if (move.status === "now" && before.status !== "now" && !before.private) await this.checkNowCap(before.companyId, before.id, actor);
    return this.save(actor, before, after);
  }

  /** Moving a Task to another Company is an explicit edit, never a drag. */
  async changeCompany(
    actor: Actor,
    id: string,
    to: { companyId: string; departmentId: string; areaId?: string | null },
  ): Promise<Task> {
    await this.requireMember(actor, "move a Task to another company");
    const before = await this.requireEditable(actor, id);
    if (before.shared) throw new BoardError("invalid", "Stop sharing this Task before moving it to another company.");
    await this.company(actor, to.companyId);
    const after: Task = {
      ...before,
      companyId: to.companyId,
      ...(await this.home(to.companyId, to.departmentId, to.areaId ?? null)),
    };
    await this.keepProjectIfHomeFits(after);
    if (countsForNow(after) && to.companyId !== before.companyId) await this.checkNowCap(to.companyId, before.id);
    return this.save(actor, before, after);
  }

  /** Any Member can join a Task as a Contributor. The Trail records it. */
  async joinTask(actor: Actor, id: string): Promise<Task> {
    await this.requireMember(actor, "join a Task");
    // A Private Task answers "not found" to anyone not on it, so nobody can join their way in (ADR 0010).
    const before = await this.requireVisible(actor, id);
    if (before.ownerIds.includes(actor.memberId) || before.contributorIds.includes(actor.memberId)) return before;
    return this.save(actor, before, { ...before, contributorIds: [...before.contributorIds, actor.memberId] });
  }

  /**
   * Share a Task with its Company team, or stop sharing it (ADR 0005). Stopping takes
   * the Company team off its Owners and Contributors.
   */
  async shareTask(actor: Actor, id: string, shared: boolean): Promise<Task> {
    await this.requireMember(actor, "share Tasks");
    const before = await this.requireEditable(actor, id);
    if (before.shared === shared) return before;
    if (shared && !canBeShared(before.departmentId)) throw cannotShare();
    if (shared && before.private) throw privateNotShared();
    const after: Task = { ...before, shared };
    if (!shared) {
      const members = new Set((await this.store.listPeople()).filter(isMember).map((p) => p.id));
      after.ownerIds = before.ownerIds.filter((p) => members.has(p));
      after.contributorIds = before.contributorIds.filter((p) => members.has(p));
    }
    return this.save(actor, before, after);
  }

  /**
   * Make a Task Private, so only its Owners and Contributors see it, or open it to every Member
   * again (ADR 0010). Whoever makes it Private must be on it, so it never vanishes for everyone.
   */
  async setPrivate(actor: Actor, id: string, isPrivate: boolean): Promise<Task> {
    const me = await this.requireMember(actor, "make Tasks private");
    const before = await this.requireEditable(actor, id);
    if (before.private === isPrivate) return before;
    if (isPrivate && before.shared) throw new BoardError("invalid", "Stop sharing this Task before making it private.");
    if (isPrivate && !isOnTask(me, before)) {
      throw new BoardError("invalid", "Join this Task before making it private, so you can still see it.");
    }
    const after: Task = { ...before, private: isPrivate };
    // A Private Task doesn't count towards Now, so opening one up takes a place there.
    if (countsForNow(after) && !before.removed) await this.checkNowCap(before.companyId, before.id, actor);
    return this.save(actor, before, after);
  }

  async removeTask(actor: Actor, id: string): Promise<Task> {
    await this.requireMember(actor, "remove Tasks");
    const before = await this.requireEditable(actor, id);
    if (before.removed) return before;
    return this.save(actor, before, { ...before, removed: true });
  }

  /** Restores a removed Task. If its Company already has a full Now, it comes back in Next. */
  async restoreTask(actor: Actor, id: string): Promise<Task> {
    await this.requireMember(actor, "restore Tasks");
    const before = await this.requireEditable(actor, id);
    if (!before.removed) return before;
    const after: Task = { ...before, removed: false };
    if (countsForNow(after) && (await this.nowCount(after.companyId, after.id)) >= NOW_CAP) after.status = "next";
    return this.save(actor, before, after);
  }

  /** Mark a Task Done with the evidence for it: the Document is added first, so Done always has its proof. */
  async finishTask(actor: Actor, id: string, evidence: NewDocument): Promise<{ task: Task; document: Document }> {
    const document = await this.addDocument(actor, id, evidence);
    const task = await this.moveTask(actor, id, { status: "done" });
    return { task, document };
  }

  // ---------- Documents ----------

  async addDocument(actor: Actor, taskId: string, input: NewDocument): Promise<Document> {
    const task = await this.requireEditable(actor, taskId);
    if (!DOCUMENT_KINDS.includes(input.kind)) throw new BoardError("invalid", "A Document is a File, a Link or Claude work.");
    if (input.kind !== "link" && !isMember(await this.person(actor))) {
      throw new BoardError("not_allowed", "You can add Links. Ask Sunridge to add Files.");
    }
    const doc = this.newDocument(task, input, actor);
    await this.commit([this.entry(actor, task, "document", doc.id, "added", null, null, doc.name)], () =>
      this.store.putDocument(doc),
    );
    return doc;
  }

  async updateDocument(
    actor: Actor,
    id: string,
    changes: { name?: string; status?: DocumentStatus },
  ): Promise<Document> {
    const { doc, task } = await this.requireEditableDocument(actor, id);
    const after: Document = { ...doc };
    if (changes.name !== undefined) after.name = cleanName(changes.name, "A Document");
    if (changes.status !== undefined) after.status = checkDocumentStatus(changes.status);
    const entries = (["name", "status"] as const)
      .filter((f) => after[f] !== doc[f])
      .map((f) => this.entry(actor, task, "document", id, "changed", f, doc[f], after[f]));
    if (!entries.length) return doc;
    await this.commit(entries, () => this.store.putDocument(after));
    return after;
  }

  /**
   * Replace a Document. It stays the same Document; the Trail keeps the old and new
   * versions. A new upload to the same SharePoint file is recorded as a new Version.
   */
  async replaceDocument(
    actor: Actor,
    id: string,
    input: { url: string; name?: string; driveItemId?: string | null },
  ): Promise<Document> {
    const { doc, task } = await this.requireEditableDocument(actor, id);
    const after: Document = {
      ...doc,
      url: cleanUrl(input.url),
      name: input.name !== undefined ? cleanName(input.name, "A Document") : doc.name,
      driveItemId: doc.kind === "file" ? (input.driveItemId ?? doc.driveItemId) : null,
    };
    const sameFile = doc.kind === "file" && doc.driveItemId !== null && after.driveItemId === doc.driveItemId;
    const entry = sameFile
      ? this.entry(actor, task, "document", id, "new_version", null, null, after.name)
      : this.entry(actor, task, "document", id, "replaced", "url", doc.url, after.url);
    await this.commit([entry], () => this.store.putDocument(after));
    return after;
  }

  /** Move a Document to another Task. Logged on both Tasks. */
  async moveDocument(actor: Actor, id: string, toTaskId: string): Promise<Document> {
    const { doc, task: from } = await this.requireEditableDocument(actor, id);
    if (toTaskId === from.id) return doc;
    const to = await this.requireEditable(actor, toTaskId);
    const after: Document = { ...doc, taskId: to.id };
    await this.commit(
      [
        this.entry(actor, from, "document", id, "moved_out", "task", from.title, to.title),
        this.entry(actor, to, "document", id, "moved_in", "task", from.title, to.title),
      ],
      () => this.store.putDocument(after),
    );
    return after;
  }

  /** Takes a Document off its Task. The SharePoint file is never deleted. */
  async removeDocument(actor: Actor, id: string): Promise<Document> {
    return this.setDocumentRemoved(actor, id, true);
  }

  async restoreDocument(actor: Actor, id: string): Promise<Document> {
    return this.setDocumentRemoved(actor, id, false);
  }

  // ---------- Areas ----------

  async createArea(actor: Actor, input: { companyId: string; departmentId: string; name: string }): Promise<Area> {
    await this.requireMember(actor, "change Areas");
    await this.company(actor, input.companyId);
    if (!isDepartmentId(input.departmentId)) throw new BoardError("invalid", "That isn't one of the six Departments.");
    const name = cleanName(input.name, "An Area", 40);
    const existing = await this.store.listAreas(input.companyId);
    if (existing.some((a) => !a.retired && a.departmentId === input.departmentId && a.name.toLowerCase() === name.toLowerCase())) {
      throw new BoardError("invalid", "That Area already exists in this Department.");
    }
    const area: Area = { id: this.newId(), companyId: input.companyId, departmentId: input.departmentId, name, retired: false };
    await this.commit([this.areaEntry(actor, area, "created", null, null, name)], () => this.store.putArea(area));
    return area;
  }

  async renameArea(actor: Actor, id: string, name: string): Promise<Area> {
    await this.requireMember(actor, "change Areas");
    const area = await this.requireArea(id);
    const after = { ...area, name: cleanName(name, "An Area", 40) };
    if (after.name === area.name) return area;
    await this.commit([this.areaEntry(actor, area, "changed", "name", area.name, after.name)], () =>
      this.store.putArea(after),
    );
    return after;
  }

  /** Retire an Area. Its open Tasks move to another Area (or straight under the Department). */
  async retireArea(actor: Actor, id: string, moveTo: { areaId: string | null }): Promise<Area> {
    await this.requireMember(actor, "change Areas");
    const area = await this.requireArea(id);
    if (moveTo.areaId === id) throw new BoardError("invalid", "Choose a different Area for its Tasks.");
    const home = moveTo.areaId
      ? await this.home(area.companyId, (await this.requireArea(moveTo.areaId)).departmentId, moveTo.areaId)
      : { departmentId: area.departmentId, areaId: null };
    const tasks = (await this.store.listTasks({ companyId: area.companyId })).filter(
      (t) => t.areaId === id && !t.removed,
    );
    if (!canBeShared(home.departmentId) && tasks.some((t) => t.shared)) throw cannotShare();
    // Its Projects move with their Tasks, so a Task and its Project keep the same Home.
    for (const project of (await this.store.listProjects({ companyId: area.companyId })).filter((p) => p.areaId === id)) {
      await this.saveProject(actor, project, { ...project, ...home });
    }
    for (const task of tasks) {
      // Done Tasks move too, so nothing points at a retired Area.
      await this.save(actor, task, { ...task, ...home });
    }
    const after = { ...area, retired: true };
    await this.commit([this.areaEntry(actor, area, "retired", null, null, area.name)], () => this.store.putArea(after));
    return after;
  }

  // ---------- People ----------

  /** Called on every sign-in, from what the HBF Portal verified, so the list of people stays current. */
  async recordPerson(person: Person): Promise<void> {
    const existing = (await this.store.listPeople()).find((p) => p.id === person.id);
    const signedInAt = existing?.signedInAt ?? person.signedInAt ?? this.clock().toISOString();
    if (!existing || changedPerson(existing, person) || existing.signedInAt !== signedInAt) {
      await this.store.putPerson({ ...person, signedInAt });
    }
  }

  /**
   * Everyone the HBF Portal lets into the board, whether or not they have signed in yet, so they
   * can be Owners from the start (ADR 0009). Never removes anyone, and never marks anyone signed in.
   */
  async recordDirectory(people: Person[]): Promise<number> {
    const existing = new Map((await this.store.listPeople()).map((p) => [p.id, p]));
    let written = 0;
    for (const person of people) {
      const before = existing.get(person.id);
      if (before && !changedPerson(before, person)) continue;
      await this.store.putPerson({ ...person, signedInAt: before?.signedInAt ?? null });
      written++;
    }
    return written;
  }

  // ---------- Projects ----------

  /** The Projects in a Company the asker can see. The Company team sees a Project only through its Shared Tasks. */
  async projects(who: Reader, companyId: string): Promise<ProjectView[]> {
    const me = await this.person(who);
    await this.company(who, companyId);
    const [projects, tasks] = await Promise.all([this.store.listProjects({ companyId }), this.store.listTasks({ companyId })]);
    return this.projectViews(me, projects, tasks.filter((t) => !t.removed && canSee(me, t)));
  }

  async project(who: Reader, id: string): Promise<{ project: Project; progress: { done: number; total: number }; tasks: Task[]; updates: ProjectUpdate[]; trail: TrailEntry[] }> {
    const me = await this.person(who);
    const project = await this.store.getProject(id);
    const notFound = new BoardError("not_found", "That Project isn't on the board.");
    if (!project) throw notFound;
    const tasks = (await this.store.listTasks({ companyId: project.companyId }))
      .filter((t) => t.projectId === id && !t.removed && canSee(me, t))
      .sort(compareTasks);
    if (!isMember(me)) {
      if (project.removed || !tasks.length) throw notFound;
      return { project: redactProject(project), progress: progress(tasks), tasks, updates: [], trail: [] };
    }
    const [updates, trail] = await Promise.all([
      this.store.listProjectUpdates({ projectId: id }),
      this.store.listTrail({ companyId: project.companyId }),
    ]);
    return {
      project,
      progress: progress(tasks),
      tasks,
      updates: updates.sort((a, b) => a.at.localeCompare(b.at)),
      trail: visibleTrail(trail.filter((e) => e.subject === "project" && e.subjectId === id)),
    };
  }

  async createProject(actor: Actor, input: NewProject): Promise<Project> {
    await this.requireMember(actor, "add Projects");
    await this.company(actor, input.companyId);
    const home = await this.home(input.companyId, input.departmentId, input.areaId ?? null);
    const now = this.clock().toISOString();
    const project: Project = {
      id: this.newId(),
      companyId: input.companyId,
      ...home,
      name: cleanName(input.name, "A Project", 80),
      goal: cleanGoal(input.goal),
      ...(await this.projectOwner(input.ownerId ?? null, input.ownerName ?? "")),
      phase: checkPhase(input.phase ?? null),
      repository: cleanRepository(input.repository),
      portalApp: cleanPortalApp(input.portalApp),
      liveUrl: input.liveUrl ? cleanUrl(input.liveUrl) : "",
      order: input.order ?? 0,
      removed: false,
      createdAt: now,
      createdBy: actor.memberId,
      updatedAt: now,
    };
    await this.commit([this.projectEntry(actor, project, "created", null, input.source?.slice(0, 120) ?? null, project.name)], () =>
      this.store.putProject(project),
    );
    return project;
  }

  async updateProject(actor: Actor, id: string, changes: ProjectChanges): Promise<Project> {
    await this.requireMember(actor, "change Projects");
    const before = await this.requireProject(id);
    const after: Project = { ...before };
    if (changes.name !== undefined) after.name = cleanName(changes.name, "A Project", 80);
    if (changes.goal !== undefined) after.goal = cleanGoal(changes.goal);
    if (changes.ownerId !== undefined || changes.ownerName !== undefined) {
      Object.assign(after, await this.projectOwner(changes.ownerId ?? null, changes.ownerName ?? ""));
    }
    if (changes.phase !== undefined) after.phase = checkPhase(changes.phase);
    if (changes.repository !== undefined) after.repository = cleanRepository(changes.repository);
    if (changes.portalApp !== undefined) after.portalApp = cleanPortalApp(changes.portalApp);
    if (changes.liveUrl !== undefined) after.liveUrl = changes.liveUrl ? cleanUrl(changes.liveUrl) : "";
    if (changes.order !== undefined) after.order = changes.order;
    return this.saveProject(actor, before, after);
  }

  /** Moves a Project to another Department or Area of its Company. Its Tasks move with it, each on its own Trail. */
  async moveProject(actor: Actor, id: string, to: { departmentId: string; areaId?: string | null }): Promise<Project> {
    await this.requireMember(actor, "move Projects");
    const before = await this.requireProject(id);
    const home = await this.home(before.companyId, to.departmentId, to.areaId ?? null);
    const tasks = (await this.store.listTasks({ companyId: before.companyId })).filter((t) => t.projectId === id);
    if (!canBeShared(home.departmentId) && tasks.some((t) => t.shared && !t.removed)) throw cannotShare();
    const after = await this.saveProject(actor, before, { ...before, ...home });
    for (const task of tasks) await this.save(actor, task, { ...task, ...home });
    return after;
  }

  /** Takes a Project off the board. Its Tasks stay, and show no Project until it is restored. */
  async removeProject(actor: Actor, id: string): Promise<Project> {
    await this.requireMember(actor, "remove Projects");
    const before = await this.requireProject(id);
    return this.saveProject(actor, before, { ...before, removed: true });
  }

  async restoreProject(actor: Actor, id: string): Promise<Project> {
    await this.requireMember(actor, "restore Projects");
    const before = await this.requireProject(id);
    return this.saveProject(actor, before, { ...before, removed: false });
  }

  /**
   * Adds a line of news to a Project. Updates are never changed or deleted. The team board sync
   * brings Updates written there with their own time and author.
   */
  async addProjectUpdate(actor: Actor, id: string, input: { text: string; at?: string; byName?: string }): Promise<ProjectUpdate> {
    const me = await this.requireMember(actor, "add Project Updates");
    const project = await this.requireProject(id);
    const text = input.text.replace(/\r\n/g, "\n").trim();
    if (!text) throw new BoardError("invalid", "An Update needs some text.");
    if (text.length > UPDATE_MAX_CHARS) throw new BoardError("invalid", `Keep an Update to ${UPDATE_MAX_CHARS} characters or fewer.`);
    const fromTeamBoard = actor.via === "sync" && input.byName !== undefined;
    const update: ProjectUpdate = {
      id: this.newId(),
      projectId: project.id,
      companyId: project.companyId,
      at: actor.via === "sync" && input.at ? input.at : this.clock().toISOString(),
      by: fromTeamBoard ? null : me.id,
      byName: fromTeamBoard ? input.byName!.slice(0, 200) : me.name,
      text,
      via: actor.via,
    };
    await this.store.appendProjectUpdates([update]);
    return update;
  }

  // ---------- internals ----------

  private async save(actor: Actor, before: Task, after: Task): Promise<Task> {
    if (after.shared && !canBeShared(after.departmentId)) throw cannotShare();
    const entries = taskDiff(before, after).map(([field, old, value]) =>
      this.entry(actor, after, "task", after.id, actionFor(field, before, after), field, old, value),
    );
    if (!entries.length) return before;
    after.updatedAt = this.clock().toISOString();
    await this.commit(entries, () => this.store.putTask(after));

    // Two people can move a Task into Now in the same second. Re-check, and move the later one back.
    if (countsForNow(after) && (!countsForNow(before) || before.companyId !== after.companyId)) {
      if ((await this.nowCount(after.companyId, null)) > NOW_CAP) {
        const reverted = { ...after, status: before.status, companyId: before.companyId, private: before.private, updatedAt: this.clock().toISOString() };
        await this.commit(
          taskDiff(after, reverted).map(([field, old, value]) =>
            this.entry(actor, reverted, "task", after.id, actionFor(field, after, reverted), field, old, value),
          ),
          () => this.store.putTask(reverted),
        );
        throw await this.nowCapError(after.companyId, actor);
      }
    }
    return after;
  }

  private async saveProject(actor: Actor, before: Project, after: Project): Promise<Project> {
    const entries = PROJECT_FIELDS.filter((f) => show(before[f]) !== show(after[f])).map((f) =>
      this.projectEntry(actor, after, f === "removed" ? (after.removed ? "removed" : "restored") : f === "departmentId" || f === "areaId" ? "moved" : "changed", f, show(before[f]), show(after[f])),
    );
    if (!entries.length) return before;
    after.updatedAt = this.clock().toISOString();
    await this.commit(entries, () => this.store.putProject(after));
    return after;
  }

  private projectEntry(actor: Actor, project: Project, action: string, field: string | null, old: string | null, value: string | null): TrailEntry {
    return {
      id: this.newId(),
      taskId: null,
      companyId: project.companyId,
      subject: "project",
      subjectId: project.id,
      memberId: actor.memberId,
      action,
      field,
      old,
      new: value,
      via: actor.via,
      at: this.clock().toISOString(),
      outcome: "ok",
    };
  }

  /** Trail first, then the change. If the change fails, the Trail says so (ADR 0003: no transactions). */
  private async commit(entries: TrailEntry[], write: () => Promise<void>): Promise<void> {
    await this.store.appendTrail(entries);
    try {
      await write();
    } catch (error) {
      await this.store.appendTrail(
        entries.map((e) => ({ ...e, id: this.newId(), action: "failed", field: e.action, old: null, new: e.id, outcome: "failed" as const })),
      );
      throw error;
    }
  }

  private entry(
    actor: Actor,
    task: Task,
    subject: "task" | "document",
    subjectId: string,
    action: string,
    field: string | null,
    old: string | null,
    value: string | null,
  ): TrailEntry {
    return {
      id: this.newId(),
      taskId: task.id,
      companyId: task.companyId,
      subject,
      subjectId,
      memberId: actor.memberId,
      action,
      field,
      old,
      new: value,
      via: actor.via,
      at: this.clock().toISOString(),
      outcome: "ok",
    };
  }

  private areaEntry(actor: Actor, area: Area, action: string, field: string | null, old: string | null, value: string | null): TrailEntry {
    return {
      id: this.newId(),
      taskId: null,
      companyId: area.companyId,
      subject: "area",
      subjectId: area.id,
      memberId: actor.memberId,
      action,
      field,
      old,
      new: value,
      via: actor.via,
      at: this.clock().toISOString(),
      outcome: "ok",
    };
  }

  private newDocument(task: Task, input: NewDocument, actor: Actor): Document {
    if (!DOCUMENT_KINDS.includes(input.kind)) throw new BoardError("invalid", "A Document is a File, a Link or Claude work.");
    checkDocumentStatus(input.status ?? "draft");
    return {
      id: this.newId(),
      taskId: task.id,
      kind: input.kind,
      name: cleanName(input.name, "A Document"),
      url: cleanUrl(input.url),
      status: input.status ?? "draft",
      driveItemId: input.kind === "file" ? (input.driveItemId ?? null) : null,
      removed: false,
      createdAt: this.clock().toISOString(),
      createdBy: actor.memberId,
    };
  }

  private async setDocumentRemoved(actor: Actor, id: string, removed: boolean): Promise<Document> {
    const { doc, task } = await this.requireEditableDocument(actor, id);
    if (doc.removed === removed) return doc;
    const after = { ...doc, removed };
    await this.commit(
      [this.entry(actor, task, "document", id, removed ? "removed" : "restored", null, doc.url, doc.name)],
      () => this.store.putDocument(after),
    );
    return after;
  }

  private async home(
    companyId: string,
    departmentId: string,
    areaId: string | null,
  ): Promise<{ departmentId: DepartmentId; areaId: string | null }> {
    if (areaId) {
      const area = await this.requireArea(areaId);
      if (area.companyId !== companyId || area.retired) {
        throw new BoardError("invalid", "That Area doesn't belong to this company.");
      }
      return { departmentId: area.departmentId, areaId };
    }
    if (!isDepartmentId(departmentId)) throw new BoardError("invalid", "Choose one of the six Departments.");
    return { departmentId, areaId: null };
  }

  private async person(who: Reader): Promise<Person> {
    const id = readerId(who);
    const person = (await this.store.listPeople()).find((p) => p.id === id);
    if (!person) throw new BoardError("not_allowed", "You aren't on the board yet. Open it from the HBF Portal.");
    return person;
  }

  private async requireMember(who: Reader, what: string): Promise<Person> {
    const person = await this.person(who);
    if (!isMember(person)) throw new BoardError("not_allowed", `Only Sunridge can ${what}.`);
    return person;
  }

  /**
   * Owners and Contributors: Members, or this Company's team on a Shared Task. Owners may also be
   * typed by name, for people who aren't on the board. A Task may have no Owner yet (ADR 0009),
   * but a Private Task needs someone on the board to see it (ADR 0010).
   */
  private async checkOwners(
    task: { companyId: string; shared: boolean; private: boolean },
    ownerIds: string[],
    ownerNames: string[],
    contributorIds: string[],
  ): Promise<{ ownerIds: string[]; ownerNames: string[]; contributorIds: string[] }> {
    const people = await this.directory();
    const check = (ids: string[], role: string) => {
      const unique = [...new Set(ids)];
      for (const id of unique) {
        const p = people.get(id);
        if (!p) throw new BoardError("invalid", `Every ${role} must be someone on the board, or typed by name.`);
        if (!isMember(p) && !(task.shared && p.companyId === task.companyId)) {
          throw new BoardError("invalid", `Someone from a company team can be an ${role} only on a Shared Task in their own company.`);
        }
      }
      return unique;
    };
    const named = people.owners(ownerIds, ownerNames);
    const owners = check(named.ownerIds, "Owner");
    const contributors = check(contributorIds, "Contributor").filter((id) => !owners.includes(id));
    if (task.private && !owners.length && !contributors.length) {
      throw new BoardError("invalid", "A Private Task needs an Owner or Contributor on the board, or nobody could see it.");
    }
    return { ownerIds: owners, ownerNames: named.ownerNames, contributorIds: contributors };
  }

  private async directory(): Promise<People> {
    return new People(await this.store.listPeople());
  }

  private projectViews(me: Person, projects: Project[], visibleTasks: Task[]): ProjectView[] {
    return projects
      .filter((p) => !p.removed)
      .map((project) => ({ project, tasks: visibleTasks.filter((t) => t.projectId === project.id) }))
      .filter(({ tasks }) => isMember(me) || tasks.length > 0)
      .map(({ project, tasks }) => ({ project: isMember(me) ? project : redactProject(project), progress: progress(tasks) }))
      .sort((a, b) => a.project.order - b.project.order || a.project.name.localeCompare(b.project.name));
  }

  /** A Project's Owner: someone on the board, or a typed name. A typed name that is someone on the board becomes them. */
  private async projectOwner(ownerId: string | null, ownerName: string): Promise<{ ownerId: string | null; ownerName: string }> {
    const people = await this.directory();
    const named = people.owners(ownerId ? [ownerId] : [], ownerName ? [ownerName] : []);
    if (named.ownerIds.length + named.ownerNames.length > 1) throw new BoardError("invalid", "A Project has one Owner.");
    const id = named.ownerIds[0] ?? null;
    if (id && !isMember(people.get(id) ?? { kind: "company" })) throw new BoardError("invalid", "A Project's Owner is someone at Sunridge.");
    return { ownerId: id, ownerName: named.ownerNames[0] ?? "" };
  }

  private async requireProject(id: string): Promise<Project> {
    const project = await this.store.getProject(id);
    if (!project) throw new BoardError("not_found", "That Project isn't on the board.");
    return project;
  }

  private async requireProjectIn(companyId: string, id: string): Promise<Project> {
    const project = await this.requireProject(id);
    if (project.companyId !== companyId || project.removed) throw new BoardError("invalid", "That Project isn't in this company.");
    return project;
  }

  /** After a Task changes Home, it stays in its Project only if the Project is still in the same Home. */
  private async keepProjectIfHomeFits(task: Task): Promise<void> {
    if (!task.projectId) return;
    const project = await this.store.getProject(task.projectId);
    const fits =
      project &&
      project.companyId === task.companyId &&
      project.departmentId === task.departmentId &&
      project.areaId === task.areaId;
    if (!fits) task.projectId = null;
  }

  private async nowCount(companyId: string, excludeTaskId: string | null): Promise<number> {
    const tasks = await this.store.listTasks({ companyId });
    return tasks.filter((t) => !t.removed && countsForNow(t) && t.id !== excludeTaskId).length;
  }

  private async checkNowCap(companyId: string, excludeTaskId: string | null, who?: Reader): Promise<void> {
    if ((await this.nowCount(companyId, excludeTaskId)) >= NOW_CAP) throw await this.nowCapError(companyId, who);
  }

  /**
   * The cap counts every Task but Private ones, including Tasks the Company team can't see, so they
   * are told whom to ask. Private Tasks are left out because no one else could move them (ADR 0010).
   */
  private async nowCapError(companyId: string, who?: Reader): Promise<BoardError> {
    const company = (await this.store.listCompanies()).find((c) => c.id === companyId);
    const name = company?.name ?? "This company";
    const companyTeam = who ? !isMember(await this.person(who)) : false;
    return new BoardError(
      "now_cap",
      companyTeam
        ? `${name} already has ${NOW_CAP} Tasks in Now. Ask Sunridge which one to move out first.`
        : `${name} already has ${NOW_CAP} Tasks in Now. Move one out first.`,
    );
  }

  private async requireTask(id: string): Promise<Task> {
    const task = await this.store.getTask(id);
    if (!task) throw new BoardError("not_found", "That Task isn't on the board.");
    return task;
  }

  /** A Task the asker may see. Anything else answers "not found", so its existence isn't revealed. */
  private async requireVisible(who: Reader, id: string): Promise<Task> {
    const [task, me] = await Promise.all([this.store.getTask(id), this.person(who)]);
    if (!task || !canSee(me, task)) throw new BoardError("not_found", "That Task isn't on the board.");
    return task;
  }

  private async requireEditable(actor: Actor, id: string): Promise<Task> {
    const task = await this.requireVisible(actor, id);
    // The team board sync copies changes people made on the team board. It acts as a Member, and any
    // Member may join any Task to change it, so the sync needn't join first (ADR 0007).
    const me = await this.person(actor);
    if (actor.via === "sync" && isMember(me)) return task;
    if (!mayChange(me, task, await this.directory())) {
      throw new BoardError("not_allowed", "Only this Task's Owners and Contributors can change it. Join it first.");
    }
    return task;
  }

  private async requireEditableDocument(actor: Actor, id: string): Promise<{ doc: Document; task: Task }> {
    const doc = await this.store.getDocument(id);
    if (!doc) throw new BoardError("not_found", "That Document isn't on the board.");
    return { doc, task: await this.requireEditable(actor, doc.taskId) };
  }

  private async requireArea(id: string): Promise<Area> {
    const area = await this.store.getArea(id);
    if (!area) throw new BoardError("not_found", "That Area isn't on the board.");
    return area;
  }
}

function checkStatus(status: Status): void {
  if (!STATUSES.includes(status)) throw new BoardError("invalid", "Choose Next, Now, Blocked or Done.");
}

function checkDocumentStatus(status: DocumentStatus): DocumentStatus {
  if (!DOCUMENT_STATUSES.includes(status)) throw new BoardError("invalid", "Choose Draft, In review or Final.");
  return status;
}

/**
 * Who may change a Task (ADR 0009): its Owners and Contributors, and any Member when none of its
 * Owners has signed in to the board yet, so work owned by a colleague without access, by a typed
 * name or by nobody can still be kept up to date. The Company team rules stay as they are (ADR 0005).
 */
export function mayChange(person: Person, task: Task, people: People): boolean {
  if (task.ownerIds.includes(person.id) || task.contributorIds.includes(person.id)) return true;
  return isMember(person) && !task.ownerIds.some((id) => people.hasSignedIn(id));
}

function changedPerson(a: Person, b: Person): boolean {
  return a.name !== b.name || a.email !== b.email || a.kind !== b.kind || a.companyId !== b.companyId;
}

const COMPANY_OWNER_MAX_CHARS = 120;
const GOAL_MAX_CHARS = 300;

function cleanCompanyOwner(value: string | undefined): string {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");
  if (clean.length > COMPANY_OWNER_MAX_CHARS) throw new BoardError("invalid", `Keep the company owner to ${COMPANY_OWNER_MAX_CHARS} characters or fewer.`);
  return clean;
}

function cleanGoal(value: string | undefined): string {
  const clean = (value ?? "").replace(/\r\n/g, "\n").trim();
  if (clean.length > GOAL_MAX_CHARS) throw new BoardError("invalid", `Keep the goal to ${GOAL_MAX_CHARS} characters or fewer.`);
  return clean;
}

/** A repository as owner/name, or its https address. */
function cleanRepository(value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) return "";
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) return clean;
  return cleanUrl(clean);
}

/** The app's slug in the HBF Portal, such as "site-flow". */
function cleanPortalApp(value: string | undefined): string {
  const clean = (value ?? "").trim().toLowerCase();
  if (clean && !/^[a-z0-9-]{1,64}$/.test(clean)) throw new BoardError("invalid", "A Portal app is its short name, such as site-flow.");
  return clean;
}

function checkPhase(phase: Phase | null): Phase | null {
  if (phase !== null && !PHASES.includes(phase)) throw new BoardError("invalid", "Choose Idea, Building, Live or Paused.");
  return phase;
}

/** What the Company team may see of a Project: its name and Home, not its goal, Owner or app details. */
function redactProject(project: Project): Project {
  return { ...project, goal: "", ownerId: null, ownerName: "", phase: null, repository: "", portalApp: "", liveUrl: "" };
}

type Field =
  | "title"
  | "status"
  | "priority"
  | "ownerIds"
  | "ownerNames"
  | "contributorIds"
  | "companyOwner"
  | "projectId"
  | "due"
  | "note"
  | "companyId"
  | "departmentId"
  | "areaId"
  | "shared"
  | "private"
  | "removed";
const FIELDS: Field[] = ["title", "status", "priority", "ownerIds", "ownerNames", "contributorIds", "companyOwner", "projectId", "due", "note", "companyId", "departmentId", "areaId", "shared", "private", "removed"];

type ProjectField = "name" | "goal" | "ownerId" | "ownerName" | "phase" | "repository" | "portalApp" | "liveUrl" | "order" | "departmentId" | "areaId" | "removed";
const PROJECT_FIELDS: ProjectField[] = ["name", "goal", "ownerId", "ownerName", "phase", "repository", "portalApp", "liveUrl", "order", "departmentId", "areaId", "removed"];

function show(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

function taskDiff(before: Task, after: Task): [Field, string | null, string | null][] {
  return FIELDS.filter((f) => show(before[f]) !== show(after[f])).map((f) => [f, show(before[f]), show(after[f])]);
}

function actionFor(field: Field, before: Task, after: Task): string {
  if (field === "removed") return after.removed ? "removed" : "restored";
  if (field === "shared") return after.shared ? "shared" : "unshared";
  if (field === "private") return after.private ? "made_private" : "opened";
  if (field === "status" || field === "companyId" || field === "departmentId" || field === "areaId" || field === "projectId") return "moved";
  if (field === "contributorIds" && after.contributorIds.length > before.contributorIds.length) return "joined";
  return "changed";
}

/** Hides entries whose write failed, and the failure markers themselves. */
export function visibleTrail(trail: TrailEntry[]): TrailEntry[] {
  const failed = new Set(trail.filter((e) => e.outcome === "failed").map((e) => e.new));
  return trail.filter((e) => e.outcome === "ok" && !failed.has(e.id)).sort((a, b) => a.at.localeCompare(b.at));
}

/** The one-line labels the Partner summary shows for last week's changes. */
function describeChange(entry: TrailEntry): string | null {
  if (entry.subject === "task") {
    if (entry.action === "created") return "Added";
    if (entry.action === "removed") return "Removed";
    if (entry.action === "restored") return "Restored";
    if (entry.action === "shared") return "Shared";
    if (entry.field === "status" && entry.new) return `Moved to ${STATUS_LABELS[entry.new as Status] ?? entry.new}`;
    if (entry.field === "priority" && entry.new) return `Priority now ${entry.new[0]!.toUpperCase()}${entry.new.slice(1)}`;
    if (entry.field === "due") return "Due date changed";
  }
  if (entry.subject === "document") {
    if (entry.action === "added" || entry.action === "moved_in") return "Document added";
    if (entry.action === "replaced" || entry.action === "new_version") return "Document updated";
  }
  return null;
}

/** Whether a Task takes one of its Company's places in Now. Private Tasks don't (ADR 0010). */
function countsForNow(task: Pick<Task, "status" | "private">): boolean {
  return task.status === "now" && !task.private;
}

function privateNotShared(): BoardError {
  return new BoardError("invalid", "A Private Task can't be Shared. Open it to Sunridge first.");
}

function cannotShare(): BoardError {
  return new BoardError("invalid", "Tasks in Talent & organisation or Finance can't be shared. Stop sharing it, or keep it in another Department.");
}
