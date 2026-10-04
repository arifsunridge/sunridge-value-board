import {
  HIGH_SHARE_WARNING,
  NOW_CAP,
  PRIORITIES,
  STATUS_LABELS,
  isDepartmentId,
  isOpen,
  type Area,
  type Company,
  type DepartmentId,
  type Document,
  type DocumentKind,
  type DocumentStatus,
  type Member,
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
  memberId: string;
  via: Via;
}

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

  members(): Promise<Member[]> {
    return this.store.listMembers().then((ms) => ms.sort((a, b) => a.name.localeCompare(b.name)));
  }

  companies(): Promise<Company[]> {
    return this.store.listCompanies();
  }

  async company(id: string): Promise<Company> {
    const company = (await this.store.listCompanies()).find((c) => c.id === id);
    if (!company) throw new BoardError("not_found", "That company isn't on the board.");
    return company;
  }

  today(): string {
    return this.clock().toISOString().slice(0, 10);
  }

  async board(companyId: string): Promise<BoardView> {
    const company = await this.company(companyId);
    const [areas, all] = await Promise.all([this.store.listAreas(companyId), this.store.listTasks({ companyId })]);
    const tasks = all.filter((t) => !t.removed).sort(compareTasks);
    const documents = await this.store.listDocuments({ taskIds: tasks.map((t) => t.id) });
    const documentCounts: Record<string, number> = {};
    for (const d of documents) if (!d.removed) documentCounts[d.taskId] = (documentCounts[d.taskId] ?? 0) + 1;
    const open = tasks.filter(isOpen);
    const highShare = open.length ? open.filter((t) => t.priority === "high").length / open.length : 0;
    return {
      company,
      areas: areas.filter((a) => !a.retired).sort((a, b) => a.name.localeCompare(b.name)),
      tasks,
      documentCounts,
      nowCount: tasks.filter((t) => t.status === "now").length,
      highShare,
      tooManyHigh: highShare > HIGH_SHARE_WARNING,
    };
  }

  async task(id: string): Promise<{ task: Task; documents: Document[]; trail: TrailEntry[] }> {
    const task = await this.requireTask(id);
    const [documents, trail] = await Promise.all([
      this.store.listDocuments({ taskIds: [id] }),
      this.store.listTrail({ taskId: id }),
    ]);
    return { task, documents, trail: visibleTrail(trail) };
  }

  async document(id: string): Promise<Document> {
    const doc = await this.store.getDocument(id);
    if (!doc) throw new BoardError("not_found", "That Document isn't on the board.");
    return doc;
  }

  /** Throws unless the actor may change this Task. Used before side effects outside the board, such as uploads. */
  async checkCanEdit(actor: Actor, taskId: string): Promise<Task> {
    return this.requireEditable(actor, taskId);
  }

  /** Tasks a Member owns or contributes to, across every Company. */
  async myTasks(memberId: string): Promise<Task[]> {
    const tasks = await this.store.listTasks({});
    return tasks
      .filter((t) => !t.removed && (t.ownerIds.includes(memberId) || t.contributorIds.includes(memberId)))
      .sort(compareTasks);
  }

  async removedTasks(companyId: string): Promise<Task[]> {
    const tasks = await this.store.listTasks({ companyId });
    return tasks.filter((t) => t.removed).sort(compareTasks);
  }

  /** The Partner view: what needs attention, what's late, and what changed in the last week. */
  async summary(companyId: string, days = 7): Promise<Summary> {
    const company = await this.company(companyId);
    const today = this.today();
    const since = new Date(this.clock().getTime() - days * 86_400_000).toISOString();
    const [all, trail] = await Promise.all([
      this.store.listTasks({ companyId }),
      this.store.listTrail({ companyId, since }),
    ]);
    const tasks = all.filter((t) => !t.removed).sort(compareTasks);
    const open = tasks.filter(isOpen);
    const attention = open.filter((t) => t.priority === "high" || t.status === "blocked");
    attention.sort((a, b) => Number(b.status === "blocked") - Number(a.status === "blocked") || compareTasks(a, b));
    const overdue = open.filter((t) => isOverdue(t, today));

    const byTask = new Map<string, string[]>();
    for (const entry of visibleTrail(trail)) {
      const label = describeChange(entry);
      if (!label || !entry.taskId) continue;
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
    await this.company(input.companyId);
    const home = await this.home(input.companyId, input.departmentId, input.areaId ?? null);
    const members = await this.memberIds();
    const ownerIds = this.people(input.ownerIds, members, "Owner");
    if (!ownerIds.length) throw new BoardError("invalid", "A Task needs at least one Owner.");
    const contributorIds = this.people(input.contributorIds ?? [], members, "Contributor").filter(
      (id) => !ownerIds.includes(id),
    );
    if (!PRIORITIES.includes(input.priority)) throw new BoardError("invalid", "Choose High, Medium or Low.");
    const status = input.status ?? "next";
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
    const members = await this.memberIds();

    if (changes.title !== undefined) after.title = cleanTitle(changes.title);
    if (changes.priority !== undefined) {
      if (!PRIORITIES.includes(changes.priority)) throw new BoardError("invalid", "Choose High, Medium or Low.");
      after.priority = changes.priority;
    }
    if (changes.ownerIds !== undefined) {
      after.ownerIds = this.people(changes.ownerIds, members, "Owner");
      if (!after.ownerIds.length) throw new BoardError("invalid", "A Task needs at least one Owner.");
    }
    if (changes.contributorIds !== undefined) {
      after.contributorIds = this.people(changes.contributorIds, members, "Contributor");
    }
    after.contributorIds = after.contributorIds.filter((c) => !after.ownerIds.includes(c));
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
    const before = await this.requireEditable(actor, id);
    const after: Task = { ...before, status: move.status };
    if (move.departmentId !== undefined || move.areaId !== undefined) {
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
    if (move.status === "now" && before.status !== "now") await this.checkNowCap(before.companyId, before.id);
    return this.save(actor, before, after);
  }

  /** Moving a Task to another Company is an explicit edit, never a drag. */
  async changeCompany(
    actor: Actor,
    id: string,
    to: { companyId: string; departmentId: string; areaId?: string | null },
  ): Promise<Task> {
    const before = await this.requireEditable(actor, id);
    await this.company(to.companyId);
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
    const before = await this.requireTask(id);
    if (before.ownerIds.includes(actor.memberId) || before.contributorIds.includes(actor.memberId)) return before;
    return this.save(actor, before, { ...before, contributorIds: [...before.contributorIds, actor.memberId] });
  }

  async removeTask(actor: Actor, id: string): Promise<Task> {
    const before = await this.requireEditable(actor, id);
    if (before.removed) return before;
    return this.save(actor, before, { ...before, removed: true });
  }

  /** Restores a removed Task. If its Company already has a full Now, it comes back in Next. */
  async restoreTask(actor: Actor, id: string): Promise<Task> {
    const before = await this.requireEditable(actor, id);
    if (!before.removed) return before;
    const after: Task = { ...before, removed: false };
    if (after.status === "now" && (await this.nowCount(after.companyId, after.id)) >= NOW_CAP) after.status = "next";
    return this.save(actor, before, after);
  }

  // ---------- Documents ----------

  async addDocument(actor: Actor, taskId: string, input: NewDocument): Promise<Document> {
    const task = await this.requireEditable(actor, taskId);
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
    if (changes.status !== undefined) after.status = changes.status;
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
    await this.company(input.companyId);
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
    const area = await this.requireArea(id);
    if (moveTo.areaId === id) throw new BoardError("invalid", "Choose a different Area for its Tasks.");
    const home = moveTo.areaId
      ? await this.home(area.companyId, (await this.requireArea(moveTo.areaId)).departmentId, moveTo.areaId)
      : { departmentId: area.departmentId, areaId: null };
    const tasks = (await this.store.listTasks({ companyId: area.companyId })).filter(
      (t) => t.areaId === id && !t.removed,
    );
    for (const task of tasks) {
      // Done Tasks move too, so nothing points at a retired Area.
      await this.save(actor, task, { ...task, ...home });
    }
    const after = { ...area, retired: true };
    await this.commit([this.areaEntry(actor, area, "retired", null, null, area.name)], () => this.store.putArea(after));
    return after;
  }

  // ---------- Members ----------

  /** Called on every sign-in so the Member list stays current. */
  async recordMember(member: Member): Promise<void> {
    const existing = (await this.store.listMembers()).find((m) => m.id === member.id);
    if (!existing || existing.name !== member.name || existing.email !== member.email) {
      await this.store.putMember(member);
    }
  }

  // ---------- internals ----------

  private async save(actor: Actor, before: Task, after: Task): Promise<Task> {
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
        throw await this.nowCapError(after.companyId);
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

  private async memberIds(): Promise<Set<string>> {
    return new Set((await this.store.listMembers()).map((m) => m.id));
  }

  private people(ids: string[], members: Set<string>, role: string): string[] {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !members.has(id))) {
      throw new BoardError("invalid", `Every ${role} must be a Sunridge Member.`);
    }
    return unique;
  }

  private async nowCount(companyId: string, excludeTaskId: string | null): Promise<number> {
    const tasks = await this.store.listTasks({ companyId });
    return tasks.filter((t) => !t.removed && t.status === "now" && t.id !== excludeTaskId).length;
  }

  private async checkNowCap(companyId: string, excludeTaskId: string | null): Promise<void> {
    if ((await this.nowCount(companyId, excludeTaskId)) >= NOW_CAP) throw await this.nowCapError(companyId);
  }

  private async nowCapError(companyId: string): Promise<BoardError> {
    const company = await this.company(companyId);
    return new BoardError("now_cap", `${company.name} already has ${NOW_CAP} Tasks in Now. Move one out first.`);
  }

  private async requireTask(id: string): Promise<Task> {
    const task = await this.store.getTask(id);
    if (!task) throw new BoardError("not_found", "That Task isn't on the board.");
    return task;
  }

  private async requireEditable(actor: Actor, id: string): Promise<Task> {
    const task = await this.requireTask(id);
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

export function canEdit(task: Task, memberId: string): boolean {
  return task.ownerIds.includes(memberId) || task.contributorIds.includes(memberId);
}

type Field = "title" | "status" | "priority" | "ownerIds" | "contributorIds" | "due" | "note" | "companyId" | "departmentId" | "areaId" | "removed";
const FIELDS: Field[] = ["title", "status", "priority", "ownerIds", "contributorIds", "due", "note", "companyId", "departmentId", "areaId", "removed"];

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
