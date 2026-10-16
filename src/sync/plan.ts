// Two-way sync with the "Sunridge team board" Claude artifact (ADR 0007, 0008, 0009).
// Pure functions: given both sides, decide what to change on each. Nothing here writes.
//
// Words: the artifact's `projects` collection holds Companies and its `groups` collection holds
// Projects. In this file "project" always means a board Project, and a team board group id is a
// "group id".

import {
  OWNER_NAMES_MAX,
  OWNER_NAME_MAX_CHARS,
  PHASES,
  PRIORITIES,
  STATUSES,
  TITLE_MAX_WORDS,
  isDepartmentId,
  type Area,
  type Company,
  type DepartmentId,
  type Person,
  type Phase,
  type Priority,
  type Project,
  type ProjectUpdate,
  type Status,
  type Task,
} from "@/board/model";
import { People } from "@/board/people";
import { cleanUrl, words } from "@/board/rules";
import { shortNote } from "@/import/team-board";

/** One action document in the artifact's `actions` collection. Unknown fields are kept as they are. */
export interface TeamBoardAction {
  title: string;
  status: string;
  priority?: string;
  categoryId?: string | null;
  projectId: string;
  groupId?: string | null;
  due?: string | null;
  ownerIds?: string[];
  /** Owners typed by name, for people who haven't opened the artifact (ADR 0009). */
  ownerNames?: string[];
  /** The portfolio company's owner, by name. The board's company owner. */
  hbfOwner?: string;
  note?: string;
  waitingOn?: string;
  removed?: boolean;
  createdAt?: string;
  editedAt?: string;
}

/** One line of a group's `log`: a Project Update. */
export interface TeamBoardLogEntry {
  at: string;
  by?: string;
  byName?: string;
  text: string;
}

/** One document in the artifact's `groups` collection: a Project. */
export interface TeamBoardGroup {
  name: string;
  note?: string;
  /** The Company, as an artifact project id. */
  projectId: string;
  /** The Area, or the whole Department. */
  categoryId: string;
  order?: number;
  ownerId?: string;
  ownerName?: string;
  phase?: string;
  repository?: string;
  portalApp?: string;
  liveUrl?: string;
  log?: TeamBoardLogEntry[];
  removed?: boolean;
  createdAt?: string;
  editedAt?: string;
}

export interface TeamBoardCategory {
  name: string;
  parentId: string | null;
  projectId: string | null;
}

export interface TeamBoardDocument {
  taskId?: string | null;
  kind: string;
  status: string;
  title: string;
  url: string;
  removed?: boolean;
}

/** Kept in the artifact's `valueBoardSync` collection, document `config`. */
export interface SyncConfig {
  /** The artifact's user ids ("u_…") to people's emails, their ids on the board. */
  people: Record<string, string>;
  /** Artifact project ids to board Company names. Several projects may share a Company. */
  projects: Record<string, string>;
  /** For Tasks added on the board: which artifact project each Company's Tasks go to. */
  newTaskProject: Record<string, string>;
  /** The artifact user the sync writes as (editedBy). Their email is the board Member it acts as. */
  syncAs: string;
}

export interface TeamBoardSnapshot {
  actions: Record<string, TeamBoardAction>;
  categories: Record<string, TeamBoardCategory>;
  groups?: Record<string, TeamBoardGroup>;
  documents?: Record<string, TeamBoardDocument>;
  config: SyncConfig;
}

export interface BoardSide {
  companies: Company[];
  areas: Area[];
  /** Every Task, removed ones too. */
  tasks: Task[];
  /** Every Project, removed ones too. */
  projects: Project[];
  /** Every Project Update. */
  updates: ProjectUpdate[];
  /** Team board ids to board ids, for what came from the team board. */
  links: { tasks: Map<string, string>; projects: Map<string, string> };
  /**
   * Tasks whose only Owner is the syncing Member, standing in for someone the sync couldn't place
   * before ADR 0009. Their Owners come from the team board once, whichever side changed last.
   */
  standIns?: Set<string>;
  /**
   * "taskId:field" for each Project, company owner or typed Owners the board has ever set (on its
   * Trail). Until then the board has no value of its own for them, so the team board's fills it in
   * whichever side changed last, and the board's empty value never goes back.
   */
  setOnBoard?: Set<string>;
  /**
   * Private Tasks (ADR 0010), which are left out of `tasks`. One the team board already has is taken
   * off it, and nothing about it comes back to the board.
   */
  privateTasks?: Set<string>;
  /** The people the board knows. Only they can be Owners by id; anyone else is a typed name. */
  people: Person[];
}

/** A Task as both boards can express it, in the board's terms. */
export interface Shape {
  companyId: string;
  departmentId: DepartmentId;
  areaName: string | null;
  title: string;
  status: Status;
  priority: Priority;
  /** Sorted emails. */
  ownerIds: string[];
  /** Typed names, sorted. */
  ownerNames: string[];
  companyOwner: string;
  /** The Project, as its team board group id. */
  groupId: string | null;
  due: string | null;
  note: string;
  removed: boolean;
}

/** A Project as both boards can express it, in the board's terms. */
export interface ProjectShape {
  companyId: string;
  departmentId: DepartmentId;
  areaName: string | null;
  name: string;
  goal: string;
  ownerId: string | null;
  ownerName: string;
  phase: Phase | null;
  repository: string;
  portalApp: string;
  liveUrl: string;
  order: number;
  removed: boolean;
}

export type Field = "title" | "status" | "priority" | "ownerIds" | "ownerNames" | "companyOwner" | "project" | "due" | "note" | "home" | "removed";
export type ProjectField = "name" | "goal" | "owner" | "phase" | "repository" | "portalApp" | "liveUrl" | "order" | "home" | "removed";

export type BoardOp =
  | {
      kind: "create";
      teamBoardId: string;
      shape: Shape;
      documents: { kind: "claude" | "link"; name: string; url: string; status: "draft" | "in_review" | "final" }[];
    }
  | { kind: "update"; teamBoardId: string; taskId: string; shape: Shape; fields: Field[] };

export type ProjectOp =
  | { kind: "create"; groupId: string; shape: ProjectShape; updates: TeamBoardLogEntry[] }
  | { kind: "update"; groupId: string; projectId: string; shape: ProjectShape; fields: ProjectField[]; updates: TeamBoardLogEntry[] };

export interface ArtifactWrite {
  op: "set" | "update";
  collection: "actions" | "groups";
  doc_id: string;
  data: Record<string, unknown>;
}

export interface SyncPlan {
  /** Applied first, so Tasks can be put in Projects made in the same run. */
  projects: ProjectOp[];
  board: BoardOp[];
  artifact: ArtifactWrite[];
  /** Counts and reasons only, never Task content (ADR 0002). */
  skipped: { side: "board" | "team board"; id: string; reason: string }[];
}

/** Artifact documents for Tasks and Projects added on the board get this id, which is also their link back. */
export const artifactIdFor = (boardId: string): string => `vb-${boardId}`;
const boardIdFromArtifactId = (id: string): string | null => (id.startsWith("vb-") ? id.slice(3) : null);

const sortIds = (ids: string[]) => [...new Set(ids)].sort();
const sortNames = (names: string[]) => [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
const lower = (list: string[]) => list.map((s) => s.toLowerCase()).join(",");
const DOCUMENT_STATUS = { draft: "draft", review: "in_review", in_review: "in_review", final: "final" } as const;
const LOG_KEEP = 200;

function cutTitle(title: string): string {
  return words(title).slice(0, TITLE_MAX_WORDS).join(" ");
}

const cut = (text: string | undefined, max: number) => (text ?? "").trim().slice(0, max);

/** Owners as the board holds them. Names the board can't hold (too long, too many) are left out, not refused. */
function ownersOf(emails: string[], names: string[], people: People): { ownerIds: string[]; ownerNames: string[] } {
  const fit = names.map((n) => n.trim()).filter((n) => n && n.length <= OWNER_NAME_MAX_CHARS);
  const owners = people.owners(emails, []);
  for (const name of fit) {
    const next = people.owners(owners.ownerIds, [...owners.ownerNames, name]);
    if (next.ownerNames.length > OWNER_NAMES_MAX) break;
    Object.assign(owners, next);
  }
  return owners;
}

/** Team board user ids to emails the board knows; unknown ones are dropped (the artifact keeps them). */
function knownEmails(userIds: string[], snapshot: TeamBoardSnapshot, people: People): string[] {
  return userIds.map((u) => snapshot.config.people[u]?.toLowerCase()).filter((e): e is string => Boolean(e) && Boolean(people.get(e!)));
}

/** Where a team board category puts something, in the board's terms. */
function homeOf(categoryId: string | null | undefined, snapshot: TeamBoardSnapshot): { departmentId: DepartmentId; areaName: string | null } {
  const category = categoryId ? snapshot.categories[categoryId] : undefined;
  const isArea = Boolean(category?.parentId);
  const deptKey = (isArea ? category!.parentId! : (categoryId ?? "")).replace(/^d-/, "");
  return { departmentId: isDepartmentId(deptKey) ? deptKey : "strategy", areaName: isArea ? category!.name : null };
}

function companyFor(artifactProjectId: string, snapshot: TeamBoardSnapshot, side: BoardSide): Company | undefined {
  const name = snapshot.config.projects[artifactProjectId];
  return side.companies.find((c) => c.name.toLowerCase() === name?.toLowerCase());
}

/** The artifact project and category for a board Home. */
function placeOnTeamBoard(
  home: { companyId: string; departmentId: DepartmentId; areaId: string | null },
  snapshot: TeamBoardSnapshot,
  side: BoardSide,
  existingProjectId?: string,
): { projectId: string; categoryId: string } {
  const company = side.companies.find((c) => c.id === home.companyId);
  const projectId =
    existingProjectId && snapshot.config.projects[existingProjectId]?.toLowerCase() === company?.name.toLowerCase()
      ? existingProjectId
      : (snapshot.config.newTaskProject[company?.name ?? ""] ?? existingProjectId ?? "");
  const area = side.areas.find((a) => a.id === home.areaId);
  const areaCategory = area
    ? Object.entries(snapshot.categories).find(
        ([, c]) =>
          c.parentId === `d-${home.departmentId}` &&
          c.name.toLowerCase() === area.name.toLowerCase() &&
          (!c.projectId || snapshot.config.projects[c.projectId]?.toLowerCase() === company?.name.toLowerCase()),
      )?.[0]
    : undefined;
  return { projectId, categoryId: areaCategory ?? `d-${home.departmentId}` };
}

/** A Project's group id on the team board, for one that came from there or went there. */
function groupIdFor(projectId: string | null, side: BoardSide): string | null {
  if (!projectId) return null;
  for (const [groupId, id] of side.links.projects) if (id === projectId) return groupId;
  return artifactIdFor(projectId);
}

// ---------- Tasks ----------

/** What a team board action is, in the board's terms. A string when it can't be placed on the board. */
export function fromTeamBoard(action: TeamBoardAction, snapshot: TeamBoardSnapshot, side: BoardSide): Shape | string {
  const company = companyFor(action.projectId, snapshot, side);
  if (!company) return "Its project has no Company on the board.";
  const people = new People(side.people);
  const status: Status = (STATUSES as readonly string[]).includes(action.status) ? (action.status as Status) : "next";
  const owners = ownersOf(knownEmails(action.ownerIds ?? [], snapshot, people), action.ownerNames ?? [], people);
  const note = shortNote(status === "blocked" ? action.waitingOn || action.note || "" : action.note || "").note;
  // The team board counts a Task in a group only when both are in the same place; so does the board.
  const group = action.groupId ? snapshot.groups?.[action.groupId] : undefined;
  const inGroup = group && !group.removed && group.projectId === action.projectId && group.categoryId === action.categoryId;
  return {
    companyId: company.id,
    ...homeOf(action.categoryId, snapshot),
    title: cutTitle(action.title) || "Untitled Task from the team board",
    status,
    priority: (PRIORITIES as readonly string[]).includes(action.priority ?? "") ? (action.priority as Priority) : "medium",
    ownerIds: sortIds(owners.ownerIds),
    ownerNames: sortNames(owners.ownerNames),
    companyOwner: cut(action.hbfOwner, 120),
    groupId: inGroup ? action.groupId! : null,
    due: action.due && /^\d{4}-\d{2}-\d{2}$/.test(action.due) ? action.due : null,
    note,
    removed: Boolean(action.removed),
  };
}

export function fromBoard(task: Task, side: BoardSide): Shape {
  return {
    companyId: task.companyId,
    departmentId: task.departmentId,
    areaName: side.areas.find((a) => a.id === task.areaId)?.name ?? null,
    title: task.title,
    status: task.status,
    priority: task.priority,
    ownerIds: sortIds(task.ownerIds),
    ownerNames: sortNames(task.ownerNames),
    companyOwner: task.companyOwner,
    groupId: groupIdFor(task.projectId, side),
    due: task.due,
    note: task.note,
    removed: task.removed,
  };
}

/**
 * The fields to write to the artifact for a board Task. Owners the artifact has no user id for go
 * as typed names; the artifact's own Owners the board doesn't know stay where they are.
 */
export function toTeamBoard(task: Task, snapshot: TeamBoardSnapshot, side: BoardSide, existing?: TeamBoardAction): Record<string, unknown> {
  const people = new People(side.people);
  const byEmail = new Map(Object.entries(snapshot.config.people).map(([u, email]) => [email.toLowerCase(), u]));
  const unknownOnTeamBoard = (existing?.ownerIds ?? []).filter((u) => !people.get(snapshot.config.people[u]?.toLowerCase() ?? ""));
  const ownerIds = [...unknownOnTeamBoard, ...task.ownerIds.map((id) => byEmail.get(id.toLowerCase())).filter((u): u is string => Boolean(u))];
  const namedOnly = task.ownerIds.filter((id) => !byEmail.has(id.toLowerCase())).map((id) => people.name(id));
  const fields: Record<string, unknown> = {
    title: task.title,
    status: task.status,
    priority: task.priority,
    ...placeOnTeamBoard(task, snapshot, side, existing?.projectId),
    groupId: groupIdFor(task.projectId, side) ?? "",
    due: task.due ?? "",
    ownerIds: [...new Set(ownerIds)],
    ownerNames: [...namedOnly, ...task.ownerNames],
    hbfOwner: task.companyOwner,
    removed: task.removed,
  };
  // A Blocked Task's note is what it waits on; the artifact keeps that apart from its note.
  if (task.status === "blocked") fields.waitingOn = task.note;
  else fields.note = task.note;
  return fields;
}

const FIELDS: Field[] = ["title", "status", "priority", "ownerIds", "ownerNames", "companyOwner", "project", "due", "note", "home", "removed"];

function same(a: Shape, b: Shape, field: Field): boolean {
  switch (field) {
    case "home":
      return a.departmentId === b.departmentId && (a.areaName ?? "").toLowerCase() === (b.areaName ?? "").toLowerCase();
    case "ownerIds":
      return a.ownerIds.join(",") === b.ownerIds.join(",");
    case "ownerNames":
      return lower(a.ownerNames) === lower(b.ownerNames);
    case "project":
      return a.groupId === b.groupId;
    default:
      return a[field] === b[field];
  }
}

// ---------- Projects ----------

/** A live address as the board keeps it, so "https://x.app" and "https://x.app/" are the same address. */
function liveUrlOf(url: string | undefined): string {
  try {
    return url ? cut(cleanUrl(url), 400) : "";
  } catch {
    return "";
  }
}

export function projectFromTeamBoard(group: TeamBoardGroup, snapshot: TeamBoardSnapshot, side: BoardSide): ProjectShape | string {
  const company = companyFor(group.projectId, snapshot, side);
  if (!company) return "Its project has no Company on the board.";
  const people = new People(side.people);
  const owner = ownersOf(knownEmails(group.ownerId ? [group.ownerId] : [], snapshot, people), group.ownerName ? [group.ownerName] : [], people);
  return {
    companyId: company.id,
    ...homeOf(group.categoryId, snapshot),
    name: cut(group.name, 80) || "Untitled Project from the team board",
    goal: cut(group.note, 300),
    ownerId: owner.ownerIds[0] ?? null,
    ownerName: owner.ownerIds.length ? "" : (owner.ownerNames[0] ?? ""),
    phase: (PHASES as readonly string[]).includes(group.phase ?? "") ? (group.phase as Phase) : null,
    repository: cut(group.repository, 400),
    portalApp: cut(group.portalApp, 64).toLowerCase(),
    liveUrl: liveUrlOf(group.liveUrl),
    order: typeof group.order === "number" && Number.isFinite(group.order) ? Math.round(group.order) : 0,
    removed: Boolean(group.removed),
  };
}

export function projectFromBoard(project: Project, side: BoardSide): ProjectShape {
  return {
    companyId: project.companyId,
    departmentId: project.departmentId,
    areaName: side.areas.find((a) => a.id === project.areaId)?.name ?? null,
    name: project.name,
    goal: project.goal,
    ownerId: project.ownerId,
    ownerName: project.ownerName,
    phase: project.phase,
    repository: project.repository,
    portalApp: project.portalApp,
    liveUrl: project.liveUrl,
    order: project.order,
    removed: project.removed,
  };
}

export function projectToTeamBoard(project: Project, snapshot: TeamBoardSnapshot, side: BoardSide, existing?: TeamBoardGroup): Record<string, unknown> {
  const people = new People(side.people);
  const byEmail = new Map(Object.entries(snapshot.config.people).map(([u, email]) => [email.toLowerCase(), u]));
  const ownerId = project.ownerId ? byEmail.get(project.ownerId.toLowerCase()) : undefined;
  const place = placeOnTeamBoard(project, snapshot, side, existing?.projectId);
  return {
    name: project.name,
    note: project.goal,
    projectId: place.projectId,
    categoryId: place.categoryId,
    order: project.order,
    ownerId: ownerId ?? "",
    // An Owner the artifact has no user id for goes by name.
    ownerName: project.ownerId && !ownerId ? people.name(project.ownerId) : project.ownerName,
    phase: project.phase ?? "",
    repository: project.repository,
    portalApp: project.portalApp,
    liveUrl: project.liveUrl,
    removed: project.removed,
  };
}

const PROJECT_FIELDS: ProjectField[] = ["name", "goal", "owner", "phase", "repository", "portalApp", "liveUrl", "order", "home", "removed"];

function sameProject(a: ProjectShape, b: ProjectShape, field: ProjectField): boolean {
  switch (field) {
    case "home":
      return a.departmentId === b.departmentId && (a.areaName ?? "").toLowerCase() === (b.areaName ?? "").toLowerCase();
    case "owner":
      return a.ownerId === b.ownerId && a.ownerName.toLowerCase() === b.ownerName.toLowerCase();
    default:
      return a[field] === b[field];
  }
}

/** An Update and a log line are the same news when they were written at the same moment with the same words. */
const newsKey = (at: string, text: string) => `${new Date(at).toISOString()}|${text.trim()}`;

function planProjects(snapshot: TeamBoardSnapshot, side: BoardSide, now: string, plan: SyncPlan): void {
  const byId = new Map(side.projects.map((p) => [p.id, p]));
  const linked = new Set<string>();
  const edited = { editedAt: now, editedBy: snapshot.config.syncAs };
  const byEmail = new Map(Object.entries(snapshot.config.people).map(([u, email]) => [email.toLowerCase(), u]));

  for (const [groupId, group] of Object.entries(snapshot.groups ?? {})) {
    const projectId = side.links.projects.get(groupId) ?? boardIdFromArtifactId(groupId);
    const project = projectId ? byId.get(projectId) : undefined;
    if (projectId) linked.add(projectId);
    const shape = projectFromTeamBoard(group, snapshot, side);
    if (typeof shape === "string") {
      plan.skipped.push({ side: "board", id: groupId, reason: shape });
      continue;
    }
    const log = (group.log ?? []).filter((e) => e && typeof e.text === "string" && e.text.trim() && !Number.isNaN(Date.parse(e.at)));
    if (!project) {
      if (group.removed || boardIdFromArtifactId(groupId)) continue;
      plan.projects.push({ kind: "create", groupId, shape, updates: log });
      continue;
    }
    if (shape.companyId !== project.companyId) {
      plan.skipped.push({ side: "board", id: groupId, reason: "It is in a different Company on each side; move it on one side." });
      continue;
    }

    // Updates are news: both sides keep every line either side wrote.
    const onBoard = side.updates.filter((u) => u.projectId === project.id);
    const boardKeys = new Set(onBoard.map((u) => newsKey(u.at, u.text)));
    const teamKeys = new Set(log.map((e) => newsKey(e.at, e.text)));
    const newOnTeamBoard = log.filter((e) => !boardKeys.has(newsKey(e.at, e.text)));
    const newOnBoard = onBoard.filter((u) => !teamKeys.has(newsKey(u.at, u.text)));

    const roundTrip = projectFromTeamBoard({ ...group, ...projectToTeamBoard(project, snapshot, side, group) } as TeamBoardGroup, snapshot, side);
    const differing = typeof roundTrip === "string" ? [] : PROJECT_FIELDS.filter((f) => !sameProject(shape, roundTrip, f));
    const teamBoardWins = (group.editedAt ?? group.createdAt ?? "") > project.updatedAt;
    if (differing.length && teamBoardWins) {
      plan.projects.push({ kind: "update", groupId, projectId: project.id, shape, fields: differing, updates: newOnTeamBoard });
    } else if (newOnTeamBoard.length) {
      plan.projects.push({ kind: "update", groupId, projectId: project.id, shape, fields: [], updates: newOnTeamBoard });
    }
    const data: Record<string, unknown> = differing.length && !teamBoardWins ? { ...projectToTeamBoard(project, snapshot, side, group) } : {};
    if (newOnBoard.length) {
      const lines = newOnBoard.map((u) => ({ at: u.at, by: (u.by && byEmail.get(u.by)) || snapshot.config.syncAs, byName: u.byName, text: u.text }));
      data.log = [...(group.log ?? []), ...lines].sort((a, b) => a.at.localeCompare(b.at)).slice(-LOG_KEEP);
    }
    if (Object.keys(data).length) plan.artifact.push({ op: "update", collection: "groups", doc_id: groupId, data: { ...data, ...edited } });
  }

  // Projects added on the board go to the team board.
  for (const project of side.projects) {
    if (linked.has(project.id) || project.removed) continue;
    const company = side.companies.find((c) => c.id === project.companyId);
    if (!company || !snapshot.config.newTaskProject[company.name]) {
      plan.skipped.push({ side: "team board", id: project.id, reason: "Its Company has no project on the team board." });
      continue;
    }
    const log = side.updates
      .filter((u) => u.projectId === project.id)
      .map((u) => ({ at: u.at, by: (u.by && byEmail.get(u.by)) || snapshot.config.syncAs, byName: u.byName, text: u.text }))
      .slice(-LOG_KEEP);
    plan.artifact.push({
      op: "set",
      collection: "groups",
      doc_id: artifactIdFor(project.id),
      data: { ...projectToTeamBoard(project, snapshot, side), log, createdAt: project.createdAt, createdBy: snapshot.config.syncAs, history: [], ...edited },
    });
  }
}

/**
 * Decides what to change on each side. Both sides are compared in the board's terms, after a round
 * trip, so a value one side can't hold (a ninth word, a third line, an owner the artifact doesn't know)
 * never counts as a change. Where they differ, the side changed more recently wins, for the whole Task.
 * A Task with no Owner stays without one: nobody stands in (ADR 0009).
 */
export function planSync(snapshot: TeamBoardSnapshot, side: BoardSide, now: string): SyncPlan {
  const plan: SyncPlan = { projects: [], board: [], artifact: [], skipped: [] };
  if (!snapshot.config.people[snapshot.config.syncAs]) throw new Error("The sync config's syncAs has no email in people.");
  // A snapshot without groups (an older routine) says nothing about Projects: leave them, and every Task's Project, alone.
  const withProjects = snapshot.groups !== undefined;
  if (withProjects) planProjects(snapshot, side, now, plan);

  const tasksById = new Map(side.tasks.map((t) => [t.id, t]));
  const linkedTaskIds = new Set<string>();
  const edited = { editedAt: now, editedBy: snapshot.config.syncAs };

  for (const [id, action] of Object.entries(snapshot.actions)) {
    const taskId = side.links.tasks.get(id) ?? boardIdFromArtifactId(id);
    const task = taskId ? tasksById.get(taskId) : undefined;
    if (taskId) linkedTaskIds.add(taskId);
    if (taskId && side.privateTasks?.has(taskId)) {
      // Made Private after it reached the team board: take it off there, and change nothing on the board.
      if (!action.removed) plan.artifact.push({ op: "update", collection: "actions", doc_id: id, data: { removed: true, ...edited } });
      continue;
    }
    const shape = fromTeamBoard(action, snapshot, side);
    if (typeof shape === "string") {
      plan.skipped.push({ side: "board", id, reason: shape });
      continue;
    }
    if (!task) {
      // Removed on the team board before it was ever synced, or a board Task that no longer exists.
      if (action.removed || boardIdFromArtifactId(id)) continue;
      plan.board.push({ kind: "create", teamBoardId: id, shape, documents: documentsFor(id, snapshot) });
      continue;
    }
    if (shape.companyId !== task.companyId) {
      plan.skipped.push({ side: "board", id, reason: "It is in a different Company on each side; move it on one side." });
      continue;
    }
    // A stand-in Owner is not an Owner: the team board's Owners replace it, whichever side changed last,
    // and it never goes to the team board.
    const standIn =
      (side.standIns?.has(task.id) ?? false) && (shape.ownerIds.join() !== task.ownerIds.join() || shape.ownerNames.length > 0);
    const current: Task = standIn ? { ...task, ownerIds: shape.ownerIds, ownerNames: shape.ownerNames } : task;
    const boardShape = fromBoard(current, side);
    // The board's value as the artifact would hold it, read back.
    const roundTrip = fromTeamBoard({ ...action, ...toTeamBoard(current, snapshot, side, action) } as TeamBoardAction, snapshot, side);
    if (typeof roundTrip === "string") continue;
    const fill = FILLED.filter(
      (f) =>
        (f !== "project" || withProjects) &&
        !side.setOnBoard?.has(`${task.id}:${FILLED_ON_BOARD[f]}`) &&
        hasValue(shape, f) &&
        !hasValue(boardShape, f),
    );
    const filled: readonly Field[] = fill;
    const differing = FIELDS.filter((f) => !same(shape, roundTrip, f) && !filled.includes(f) && (f !== "project" || withProjects));
    const release: Field[] = standIn ? ["ownerIds", "ownerNames"] : [];
    const teamBoardTime = action.editedAt ?? action.createdAt ?? "";
    if (differing.length && teamBoardTime > task.updatedAt) {
      plan.board.push({
        kind: "update",
        teamBoardId: id,
        taskId: task.id,
        shape: { ...shape, ownerIds: keepUnknownOwners(shape, boardShape, snapshot) },
        fields: [...new Set([...differing, ...release, ...fill])],
      });
      continue;
    }
    if (standIn || fill.length) {
      // Only these fields come across; the board keeps the Owners it chose unless a stand-in is released.
      const keep = standIn ? shape : { ...shape, ownerIds: sortIds(task.ownerIds) };
      plan.board.push({ kind: "update", teamBoardId: id, taskId: task.id, shape: keep, fields: [...new Set([...release, ...fill])] });
    }
    if (!differing.length) continue;
    const data: Record<string, unknown> = { ...toTeamBoard(current, snapshot, side, action), ...edited };
    // The team board keeps what the board hasn't got yet, and its own Project when the routine sent no groups.
    if (fill.includes("project") || !withProjects) data.groupId = action.groupId ?? "";
    if (fill.includes("companyOwner")) data.hbfOwner = action.hbfOwner ?? "";
    if (fill.includes("ownerNames")) data.ownerNames = action.ownerNames ?? [];
    plan.artifact.push({ op: "update", collection: "actions", doc_id: id, data });
  }

  // Tasks added on the board go to the team board.
  for (const task of side.tasks) {
    if (linkedTaskIds.has(task.id) || task.removed) continue;
    const company = side.companies.find((c) => c.id === task.companyId);
    if (!company || !snapshot.config.newTaskProject[company.name]) {
      plan.skipped.push({ side: "team board", id: task.id, reason: "Its Company has no project on the team board." });
      continue;
    }
    plan.artifact.push({
      op: "set",
      collection: "actions",
      doc_id: artifactIdFor(task.id),
      data: { ...toTeamBoard(task, snapshot, side), createdAt: task.createdAt, createdBy: snapshot.config.syncAs, history: [], ...edited },
    });
  }
  return plan;
}

/** Fields this release added to the sync, and their names on the board's Trail. */
const FILLED = ["project", "companyOwner", "ownerNames"] as const satisfies readonly Field[];
const FILLED_ON_BOARD: Record<(typeof FILLED)[number], string> = { project: "projectId", companyOwner: "companyOwner", ownerNames: "ownerNames" };

function hasValue(shape: Shape, field: (typeof FILLED)[number]): boolean {
  if (field === "project") return shape.groupId !== null;
  if (field === "companyOwner") return shape.companyOwner !== "";
  return shape.ownerNames.length > 0;
}

/** Owners the team board can't name stay on the board Task. */
function keepUnknownOwners(fromTeam: Shape, onBoard: Shape, snapshot: TeamBoardSnapshot): string[] {
  const known = new Set(Object.values(snapshot.config.people).map((e) => e.toLowerCase()));
  return sortIds([...fromTeam.ownerIds, ...onBoard.ownerIds.filter((e) => !known.has(e.toLowerCase()))]);
}

function documentsFor(teamBoardId: string, snapshot: TeamBoardSnapshot): Extract<BoardOp, { kind: "create" }>["documents"] {
  return Object.values(snapshot.documents ?? {})
    .filter((d) => d.taskId === teamBoardId && !d.removed && /^https:\/\//.test(d.url) && (d.kind === "claude" || d.kind === "link"))
    .map((d) => ({
      kind: d.kind as "claude" | "link",
      name: d.title.slice(0, 120),
      url: d.url,
      status: DOCUMENT_STATUS[d.status as keyof typeof DOCUMENT_STATUS] ?? "draft",
    }));
}
