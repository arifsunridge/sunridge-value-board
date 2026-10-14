import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  HIGH_SHARE_WARNING,
  NOW_CAP,
  PRIORITIES,
  STATUSES,
  STATUS_LABELS,
  canBeShared,
  canSee,
  isDepartmentId,
  isMember,
  isOpen,
  type Area,
  type Company,
  type DepartmentId,
  type Document,
  type DocumentKind,
  type DocumentStatus,
  type Person,
  type Priority,
  type Status,
  type Task,
  type TrailEntry,
  type Via,
} from "./model";
import { BoardError, cleanDue, cleanName, cleanNote, cleanTitle, cleanUrl } from "./rules";
import type { Store } from "@/store/store";

/** Who is acting, and through which door (screen, Capture, Claude, import). */
export interface Actor {
  /** The Person's id. Named for the Trail column, which records Managers too. */
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
  ownerIds: string[];
  contributorIds?: string[];
  due?: string | null;
  note?: string | null;
  /** Visible to the Company's Managers. Off unless set. */
  shared?: boolean;
  /** Where a Task came from, kept in its first Trail entry, e.g. "Meeting notes, 2 Oct". */
  source?: string;
}

export interface TaskChanges {
  title?: string;
  priority?: Priority;
  ownerIds?: string[];
  contributorIds?: string[];
  due?: string | null;
  note?: string;
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

  /** Everyone the asker may see on the board: Members, plus Managers of the asker's own Company. */
  async people(who: Reader): Promise<Person[]> {
    const me = await this.person(who);
    const all = await this.store.listPeople();
    return all
      .filter((p) => isMember(p) || isMember(me) || p.companyId === me.companyId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The Companies the asker may open. A Manager sees only their own. */
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
    // A Manager sees only the Areas that hold a Task shared with them; Area names can be sensitive too.
    const usedAreas = new Set(tasks.map((t) => t.areaId));
    const areas = allAreas.filter((a) => !a.retired && (isMember(me) || usedAreas.has(a.id)));
    return {
      company,
      areas: areas.sort((a, b) => a.name.localeCompare(b.name)),
      tasks,
      documentCounts,
      nowCount: tasks.filter((t) => t.status === "now").length,
      highShare,
      tooManyHigh: highShare > HIGH_SHARE_WARNING,
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

  async removedTasks(who: Reader, companyId: string): Promise<Task[]> {
    await this.requireMember(who, "see removed Tasks");
    const tasks = await this.store.listTasks({ companyId });
    return tasks.filter((t) => t.removed).sort(compareTasks);
  }

  /** The Partner view: what needs attention, what's late, and what changed in the last week. */
  async summary(who: Reader, companyId: string, days = 7): Promise<Summary> {
    const me = await this.person(who);
    const company = await this.company(who, companyId);
    const today = this.today();
    const since = new Date(this.clock().getTime() - days * 86_400_000).toISOString();
    const [all, trail] = await Promise.all([
      this.store.listTasks({ companyId }),
      this.store.listTrail({ companyId, since }),
    ]);
    const tasks = all.filter((t) => !t.removed && canSee(me, t)).sort(compareTasks);
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
    return { company, attention, overdue, changes, rest: open.filter((t) => !shown.has(t.id)) };
  }

  // ---------- Tasks ----------

  async createTask(actor: Actor, input: NewTask): Promise<Task> {
    await this.requireMember(actor, "add Tasks");
    await this.company(actor, input.companyId);
    const home = await this.home(input.companyId, input.departmentId, input.areaId ?? null);
    const shared = input.shared ?? false;
    if (shared && !canBeShared(home.departmentId)) throw cannotShare();
    const { ownerIds, contributorIds } = await this.checkPeople(
      { companyId: input.companyId, shared },
      input.ownerIds,
      input.contributorIds ?? [],
    );
    if (!PRIORITIES.includes(input.priority)) throw new BoardError("invalid", "Choose High, Medium or Low.");
    const status = input.status ?? "next";
    checkStatus(status);
    const note = cleanNote(input.note);
    if (status === "blocked" && !note) {
      throw new BoardError("waiting_on_required", "Say what this Task is waiting on.");
    }
    if (status === "now") await this.checkNowCap(input.companyId, null);

    const now = this.clock().toISOString();
    const task: Task = {
      id: this.newId(),
      companyId: input.companyId,
      ...home,
      title: cleanTitle(input.title),
      status,
      priority: input.priority,
      ownerIds,
      contributorIds,
      due: cleanDue(input.due),
      note,
      shared,
      removed: false,
      leverId: null,
      createdAt: now,
      createdBy: actor.memberId,
      updatedAt: now,
    };
    await this.commit(
      [this.entry(actor, task, "task", task.id, "created", null, input.source?.slice(0, 120) ?? null, task.title)],
      () => this.store.putTask(task),
    );
    return task;
  }

  async updateTask(actor: Actor, id: string, changes: TaskChanges): Promise<Task> {
    const before = await this.requireEditable(actor, id);
    const after: Task = { ...before };
    const me = await this.person(actor);
    if (!isMember(me) && (changes.priority !== undefined || changes.ownerIds !== undefined || changes.contributorIds !== undefined)) {
      throw new BoardError("not_allowed", "Only Sunridge can change the Priority, Owners and Contributors.");
    }

    if (changes.title !== undefined) after.title = cleanTitle(changes.title);
    if (changes.priority !== undefined) {
      if (!PRIORITIES.includes(changes.priority)) throw new BoardError("invalid", "Choose High, Medium or Low.");
      after.priority = changes.priority;
    }
    if (changes.ownerIds !== undefined || changes.contributorIds !== undefined) {
      Object.assign(
        after,
        await this.checkPeople(after, changes.ownerIds ?? after.ownerIds, changes.contributorIds ?? after.contributorIds),
      );
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
    }
    if (move.status === "blocked" && before.status !== "blocked") {
      const waitingOn = cleanNote(move.waitingOn);
      if (!waitingOn) throw new BoardError("waiting_on_required", "Say what this Task is waiting on.");
      after.note = waitingOn;
    }
    if (move.status === "now" && before.status !== "now") await this.checkNowCap(before.companyId, before.id, actor);
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
    if (after.status === "now" && to.companyId !== before.companyId) await this.checkNowCap(to.companyId, before.id);
    return this.save(actor, before, after);
  }

  /** Any Member can join a Task as a Contributor. The Trail records it. */
  async joinTask(actor: Actor, id: string): Promise<Task> {
    await this.requireMember(actor, "join a Task");
    const before = await this.requireTask(id);
    if (before.ownerIds.includes(actor.memberId) || before.contributorIds.includes(actor.memberId)) return before;
    return this.save(actor, before, { ...before, contributorIds: [...before.contributorIds, actor.memberId] });
  }

  /**
   * Share a Task with its Company's Managers, or stop sharing it (ADR 0005). Stopping takes
   * Managers off its Owners and Contributors; every Task keeps a Member as Owner, so it is never left without one.
   */
  async shareTask(actor: Actor, id: string, shared: boolean): Promise<Task> {
    await this.requireMember(actor, "share Tasks");
    const before = await this.requireEditable(actor, id);
    if (before.shared === shared) return before;
    if (shared && !canBeShared(before.departmentId)) throw cannotShare();
    const after: Task = { ...before, shared };
    if (!shared) {
      const members = new Set((await this.store.listPeople()).filter(isMember).map((p) => p.id));
      after.ownerIds = before.ownerIds.filter((p) => members.has(p));
      after.contributorIds = before.contributorIds.filter((p) => members.has(p));
    }
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
    if (after.status === "now" && (await this.nowCount(after.companyId, after.id)) >= NOW_CAP) after.status = "next";
    return this.save(actor, before, after);
  }

  // ---------- Documents ----------

  async addDocument(actor: Actor, taskId: string, input: NewDocument): Promise<Document> {
    const task = await this.requireEditable(actor, taskId);
    if (!DOCUMENT_KINDS.includes(input.kind)) throw new BoardError("invalid", "A Document is a File, a Link or Claude work.");
    if (input.kind !== "link" && !isMember(await this.person(actor))) {
      throw new BoardError("not_allowed", "You can add Links. Ask Sunridge to add Files.");
    }
    checkDocumentStatus(input.status ?? "draft");
    const doc: Document = {
      id: this.newId(),
      taskId,
      kind: input.kind,
      name: cleanName(input.name, "A Document"),
      url: cleanUrl(input.url),
      status: input.status ?? "draft",
      driveItemId: input.kind === "file" ? (input.driveItemId ?? null) : null,
      removed: false,
      createdAt: this.clock().toISOString(),
      createdBy: actor.memberId,
    };
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
    if (
      !existing ||
      existing.name !== person.name ||
      existing.email !== person.email ||
      existing.kind !== person.kind ||
      existing.companyId !== person.companyId
    ) {
      await this.store.putPerson(person);
    }
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
    if (after.status === "now" && (before.status !== "now" || before.companyId !== after.companyId)) {
      if ((await this.nowCount(after.companyId, null)) > NOW_CAP) {
        const reverted = { ...after, status: before.status, companyId: before.companyId, updatedAt: this.clock().toISOString() };
        await this.commit(
          [this.entry(actor, reverted, "task", after.id, "moved", "status", "now", before.status)],
          () => this.store.putTask(reverted),
        );
        throw await this.nowCapError(after.companyId, actor);
      }
    }
    return after;
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
   * Owners and Contributors: Members, or this Company's Managers on a Shared Task.
   * At least one Owner is a Member, so Sunridge stays accountable for every Task.
   */
  private async checkPeople(
    task: { companyId: string; shared: boolean },
    ownerIds: string[],
    contributorIds: string[],
  ): Promise<{ ownerIds: string[]; contributorIds: string[] }> {
    const everyone = new Map((await this.store.listPeople()).map((p) => [p.id, p]));
    const check = (ids: string[], role: string) => {
      const unique = [...new Set(ids)];
      for (const id of unique) {
        const p = everyone.get(id);
        if (!p) throw new BoardError("invalid", `Every ${role} must be someone on the board.`);
        if (!isMember(p) && !(task.shared && p.companyId === task.companyId)) {
          throw new BoardError("invalid", `A Manager can be an ${role} only on a Shared Task in their own company.`);
        }
      }
      return unique;
    };
    const owners = check(ownerIds, "Owner");
    if (!owners.length) throw new BoardError("invalid", "A Task needs at least one Owner.");
    if (!owners.some((id) => isMember(everyone.get(id)!))) {
      throw new BoardError("invalid", "A Task needs at least one Owner from Sunridge.");
    }
    const contributors = check(contributorIds, "Contributor").filter((id) => !owners.includes(id));
    return { ownerIds: owners, contributorIds: contributors };
  }

  private async nowCount(companyId: string, excludeTaskId: string | null): Promise<number> {
    const tasks = await this.store.listTasks({ companyId });
    return tasks.filter((t) => !t.removed && t.status === "now" && t.id !== excludeTaskId).length;
  }

  private async checkNowCap(companyId: string, excludeTaskId: string | null, who?: Reader): Promise<void> {
    if ((await this.nowCount(companyId, excludeTaskId)) >= NOW_CAP) throw await this.nowCapError(companyId, who);
  }

  /** The cap counts every Task, including ones a Manager can't see, so a Manager is told whom to ask. */
  private async nowCapError(companyId: string, who?: Reader): Promise<BoardError> {
    const company = (await this.store.listCompanies()).find((c) => c.id === companyId);
    const name = company?.name ?? "This company";
    const manager = who ? !isMember(await this.person(who)) : false;
    return new BoardError(
      "now_cap",
      manager
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
    if (!canEdit(task, actor.memberId)) {
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

export function canEdit(task: Task, memberId: string): boolean {
  return task.ownerIds.includes(memberId) || task.contributorIds.includes(memberId);
}

type Field = "title" | "status" | "priority" | "ownerIds" | "contributorIds" | "due" | "note" | "companyId" | "departmentId" | "areaId" | "shared" | "removed";
const FIELDS: Field[] = ["title", "status", "priority", "ownerIds", "contributorIds", "due", "note", "companyId", "departmentId", "areaId", "shared", "removed"];

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
  if (field === "status" || field === "companyId" || field === "departmentId" || field === "areaId") return "moved";
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

function cannotShare(): BoardError {
  return new BoardError("invalid", "Tasks in Talent & organisation or Finance can't be shared. Stop sharing it, or keep it in another Department.");
}
