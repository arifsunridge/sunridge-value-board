// Two-way sync with the "Sunridge team board" Claude artifact (ADR 0007).
// Pure functions: given both sides, decide what to change on each. Nothing here writes.

import {
  PRIORITIES,
  STATUSES,
  TITLE_MAX_WORDS,
  isDepartmentId,
  type Area,
  type Company,
  type DepartmentId,
  type Priority,
  type Status,
  type Task,
} from "@/board/model";
import { words } from "@/board/rules";
import { shortNote } from "@/import/team-board";

/** One action document in the artifact's `actions` collection. Unknown fields are kept as they are. */
export interface TeamBoardAction {
  title: string;
  status: string;
  priority?: string;
  categoryId?: string | null;
  projectId: string;
  due?: string | null;
  ownerIds?: string[];
  note?: string;
  waitingOn?: string;
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
  documents?: Record<string, TeamBoardDocument>;
  config: SyncConfig;
}

export interface BoardSide {
  companies: Company[];
  areas: Area[];
  /** Every Task, removed ones too. */
  tasks: Task[];
  /** Team board id → Task id, for Tasks that came from the team board. */
  links: Map<string, string>;
  /** Ids of the people the board knows. Only they can be Owners. */
  people: string[];
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
  due: string | null;
  note: string;
  removed: boolean;
}

export type Field = "title" | "status" | "priority" | "ownerIds" | "due" | "note" | "home" | "removed";

export type BoardOp =
  | {
      kind: "create";
      teamBoardId: string;
      shape: Shape;
      documents: { kind: "claude" | "link"; name: string; url: string; status: "draft" | "in_review" | "final" }[];
    }
  | { kind: "update"; teamBoardId: string; taskId: string; shape: Shape; fields: Field[] };

export interface ArtifactWrite {
  op: "set" | "update";
  collection: "actions";
  doc_id: string;
  data: Record<string, unknown>;
}

export interface SyncPlan {
  board: BoardOp[];
  artifact: ArtifactWrite[];
  /** Counts and reasons only, never Task content (ADR 0002). */
  skipped: { side: "board" | "team board"; id: string; reason: string }[];
}

/** Artifact documents for Tasks added on the board get this id, which is also their link back. */
export const artifactIdFor = (taskId: string): string => `vb-${taskId}`;
const taskIdFromArtifactId = (id: string): string | null => (id.startsWith("vb-") ? id.slice(3) : null);

const sortIds = (ids: string[]) => [...new Set(ids)].sort();
const DOCUMENT_STATUS = { draft: "draft", review: "in_review", in_review: "in_review", final: "final" } as const;

function cutTitle(title: string): string {
  return words(title).slice(0, TITLE_MAX_WORDS).join(" ");
}

/** What a team board action is, in the board's terms. Null when it can't be placed on the board. */
export function fromTeamBoard(action: TeamBoardAction, snapshot: TeamBoardSnapshot, side: BoardSide, fallbackOwner: string): Shape | string {
  const companyName = snapshot.config.projects[action.projectId];
  const company = side.companies.find((c) => c.name.toLowerCase() === companyName?.toLowerCase());
  if (!company) return "Its project has no Company on the board.";
  const category = action.categoryId ? snapshot.categories[action.categoryId] : undefined;
  const isArea = Boolean(category?.parentId);
  const deptKey = (isArea ? category!.parentId! : (action.categoryId ?? "")).replace(/^d-/, "");
  const status: Status = (STATUSES as readonly string[]).includes(action.status) ? (action.status as Status) : "next";
  const known = new Set(side.people.map((p) => p.toLowerCase()));
  const owners = (action.ownerIds ?? [])
    .map((u) => snapshot.config.people[u]?.toLowerCase())
    .filter((e): e is string => Boolean(e) && known.has(e!));
  const note = shortNote(status === "blocked" ? action.waitingOn || action.note || "" : action.note || "").note;
  return {
    companyId: company.id,
    departmentId: isDepartmentId(deptKey) ? deptKey : "strategy",
    areaName: isArea ? category!.name : null,
    title: cutTitle(action.title) || "Untitled Task from the team board",
    status,
    priority: (PRIORITIES as readonly string[]).includes(action.priority ?? "") ? (action.priority as Priority) : "medium",
    ownerIds: sortIds(owners.length ? owners : [fallbackOwner.toLowerCase()]),
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
    due: task.due,
    note: task.note,
    removed: task.removed,
  };
}

/** The fields to write to the artifact for a board Task. Owners without a team board id are left out. */
export function toTeamBoard(task: Task, snapshot: TeamBoardSnapshot, side: BoardSide, existing?: TeamBoardAction): Record<string, unknown> {
  const byEmail = new Map(Object.entries(snapshot.config.people).map(([u, email]) => [email.toLowerCase(), u]));
  const company = side.companies.find((c) => c.id === task.companyId);
  const projectId =
    existing && snapshot.config.projects[existing.projectId]?.toLowerCase() === company?.name.toLowerCase()
      ? existing.projectId
      : (snapshot.config.newTaskProject[company?.name ?? ""] ?? existing?.projectId ?? "");
  const area = side.areas.find((a) => a.id === task.areaId);
  const areaCategory = area
    ? Object.entries(snapshot.categories).find(
        ([, c]) =>
          c.parentId === `d-${task.departmentId}` &&
          c.name.toLowerCase() === area.name.toLowerCase() &&
          (!c.projectId || snapshot.config.projects[c.projectId]?.toLowerCase() === company?.name.toLowerCase()),
      )?.[0]
    : undefined;
  const fields: Record<string, unknown> = {
    title: task.title,
    status: task.status,
    priority: task.priority,
    projectId,
    categoryId: areaCategory ?? `d-${task.departmentId}`,
    due: task.due ?? "",
    ownerIds: task.ownerIds.map((id) => byEmail.get(id.toLowerCase())).filter(Boolean),
    removed: task.removed,
  };
  // A Blocked Task's note is what it waits on; the artifact keeps that apart from its note.
  if (task.status === "blocked") fields.waitingOn = task.note;
  else fields.note = task.note;
  return fields;
}

const FIELDS: Field[] = ["title", "status", "priority", "ownerIds", "due", "note", "home", "removed"];

function same(a: Shape, b: Shape, field: Field): boolean {
  switch (field) {
    case "home":
      return a.departmentId === b.departmentId && (a.areaName ?? "").toLowerCase() === (b.areaName ?? "").toLowerCase();
    case "ownerIds":
      return a.ownerIds.join(",") === b.ownerIds.join(",");
    default:
      return a[field] === b[field];
  }
}

/**
 * Decides what to change on each side. Both sides are compared in the board's terms, after a round
 * trip, so a value one side can't hold (a ninth word, a third line, an owner the artifact doesn't know)
 * never counts as a change. Where they differ, the side changed more recently wins, for the whole Task.
 */
export function planSync(snapshot: TeamBoardSnapshot, side: BoardSide, now: string): SyncPlan {
  const plan: SyncPlan = { board: [], artifact: [], skipped: [] };
  const fallbackOwner = snapshot.config.people[snapshot.config.syncAs]?.toLowerCase();
  if (!fallbackOwner) throw new Error("The sync config's syncAs has no email in people.");
  const tasksById = new Map(side.tasks.map((t) => [t.id, t]));
  const linkedTaskIds = new Set<string>();
  const edited = { editedAt: now, editedBy: snapshot.config.syncAs };

  for (const [id, action] of Object.entries(snapshot.actions)) {
    const taskId = side.links.get(id) ?? taskIdFromArtifactId(id);
    const task = taskId ? tasksById.get(taskId) : undefined;
    if (taskId) linkedTaskIds.add(taskId);
    const shape = fromTeamBoard(action, snapshot, side, fallbackOwner);
    if (typeof shape === "string") {
      plan.skipped.push({ side: "board", id, reason: shape });
      continue;
    }
    if (!task) {
      // Removed on the team board before it was ever synced, or a board Task that no longer exists.
      if (action.removed || taskIdFromArtifactId(id)) continue;
      plan.board.push({ kind: "create", teamBoardId: id, shape, documents: documentsFor(id, snapshot) });
      continue;
    }
    if (shape.companyId !== task.companyId) {
      plan.skipped.push({ side: "board", id, reason: "It is in a different Company on each side; move it on one side." });
      continue;
    }
    const boardShape = fromBoard(task, side);
    // The board's value as the artifact would hold it, read back.
    const roundTrip = fromTeamBoard({ ...action, ...toTeamBoard(task, snapshot, side, action) } as TeamBoardAction, snapshot, side, fallbackOwner);
    if (typeof roundTrip === "string") continue;
    const differing = FIELDS.filter((f) => !same(shape, roundTrip, f));
    if (!differing.length) continue;
    const teamBoardTime = action.editedAt ?? action.createdAt ?? "";
    // The syncing Member stands in as Owner until the team board's Owners sign in; a stand-in never wins.
    const standIn = boardShape.ownerIds.join(",") === fallbackOwner && !shape.ownerIds.includes(fallbackOwner);
    const update = (fields: Field[]): BoardOp => ({
      kind: "update",
      teamBoardId: id,
      taskId: task.id,
      shape: { ...shape, ownerIds: keepUnknownOwners(shape, boardShape, snapshot) },
      fields,
    });
    if (teamBoardTime > task.updatedAt) {
      plan.board.push(update(differing));
      continue;
    }
    if (standIn && differing.includes("ownerIds")) plan.board.push(update(["ownerIds"]));
    if (standIn && differing.length === 1 && differing[0] === "ownerIds") continue;
    const data: Record<string, unknown> = { ...toTeamBoard(task, snapshot, side, action), ...edited };
    if (standIn) delete data.ownerIds;
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
