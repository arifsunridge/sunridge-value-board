// The board's domain model. Names follow GLOSSARY.md exactly.

export const DEPARTMENTS = [
  { id: "strategy", name: "Strategic planning" },
  { id: "sales", name: "Sales & distribution" },
  { id: "operations", name: "Operations" },
  { id: "talent", name: "Talent & organisation" },
  { id: "innovation", name: "Innovation & efficiency" },
  { id: "finance", name: "Finance" },
] as const;
export type DepartmentId = (typeof DEPARTMENTS)[number]["id"];

export const STATUSES = ["next", "now", "blocked", "done"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<Status, string> = { next: "Next", now: "Now", blocked: "Blocked", done: "Done" };

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const PRIORITY_RULE: Record<Priority, string> = {
  high: "If this slips a week, a Target or Lever misses, or the business is exposed (cash, lenders, a key customer, safety, compliance).",
  medium: "Needed this quarter, but a week's slip changes nothing that matters.",
  low: "Everything else.",
};

export const DOCUMENT_KINDS = ["file", "link", "claude"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = { file: "File", link: "Link", claude: "Claude work" };

export const DOCUMENT_STATUSES = ["draft", "in_review", "final"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = { draft: "Draft", in_review: "In review", final: "Final" };

export const NOW_CAP = 10;
export const HIGH_SHARE_WARNING = 0.25;
export const TITLE_MAX_WORDS = 8;
export const NOTE_MAX_CHARS = 200;
export const NOTE_MAX_LINES = 2;
/** Owners typed by name: people who aren't on the board, such as a Sunridge colleague who has never signed in. */
export const OWNER_NAMES_MAX = 5;
export const OWNER_NAME_MAX_CHARS = 80;
export const UPDATE_MAX_CHARS = 500;

export const PHASES = ["idea", "building", "live", "paused"] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABELS: Record<Phase, string> = { idea: "Idea", building: "Building", live: "Live", paused: "Paused" };

/** A Member works at Sunridge (portal role "Sunridge team"); a company kind is in a portfolio company's Company team, such as the HBF team (ADR 0005). */
export type PersonKind = "member" | "company";

export interface Person {
  /** The lower-cased email the HBF Portal verified (ADR 0006). */
  id: string;
  name: string;
  email: string;
  kind: PersonKind;
  /** The Company whose team this Person is in. Always null for a Member. */
  companyId: string | null;
  /** When they first signed in to the board. Null for someone the HBF Portal lets in who hasn't yet (ADR 0009). */
  signedInAt: string | null;
}

/** Talent & organisation and Finance hold people, financing and exit work. Their Tasks are never Shared. */
export const NEVER_SHARED: readonly DepartmentId[] = ["talent", "finance"];

export interface Company {
  id: string;
  name: string;
  kind: "portfolio" | "sunridge";
  /** Content language: US English for US companies, British English for Sunridge. */
  english: "US" | "UK";
  order: number;
}

export interface Area {
  id: string;
  companyId: string;
  departmentId: DepartmentId;
  name: string;
  retired: boolean;
}

export interface Task {
  id: string;
  companyId: string;
  departmentId: DepartmentId;
  areaId: string | null;
  title: string;
  status: Status;
  priority: Priority;
  /** Owners who are People on the board. A Task may have no Owner yet (ADR 0009). */
  ownerIds: string[];
  /** Owners typed by name, for people who aren't on the board. */
  ownerNames: string[];
  contributorIds: string[];
  /** Who answers for the Task at the portfolio company, typed by name. Gives no rights on the board. */
  companyOwner: string;
  /** The Project this Task is part of, in the same Home (ADR 0008). */
  projectId: string | null;
  /** ISO date, YYYY-MM-DD. */
  due: string | null;
  note: string;
  /** Visible to the Company team (ADR 0005). Off unless a Member turns it on. */
  shared: boolean;
  removed: boolean;
  /** v2: the Lever this Task supports. Always null in v1. */
  leverId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  taskId: string;
  kind: DocumentKind;
  name: string;
  url: string;
  status: DocumentStatus;
  /** SharePoint drive item ID, for Files only. */
  driveItemId: string | null;
  removed: boolean;
  createdAt: string;
  createdBy: string;
}

/** A named piece of work that groups Tasks in one Home, with a goal, an Owner and a Phase (ADR 0008). */
export interface Project {
  id: string;
  companyId: string;
  departmentId: DepartmentId;
  areaId: string | null;
  name: string;
  goal: string;
  /** The Owner: a Person on the board, or a typed name. */
  ownerId: string | null;
  ownerName: string;
  phase: Phase | null;
  /** For a Project that builds an app: where its code, Portal tile and live address are. */
  repository: string;
  portalApp: string;
  liveUrl: string;
  order: number;
  removed: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** A dated line of news on a Project. Append-only, like the Trail. */
export interface ProjectUpdate {
  id: string;
  projectId: string;
  companyId: string;
  at: string;
  /** The Person who wrote it, when they are on the board. */
  by: string | null;
  /** Who wrote it, as written, when they aren't on the board (from the team board). */
  byName: string;
  text: string;
  via: Via;
}

export type Via = "screen" | "capture" | "claude" | "import" | "sync";

/** Where a Task from the team board came from, kept in its first Trail entry; the link for the sync (ADR 0007). */
export const teamBoardSource = (teamBoardId: string): string => `Team board (${teamBoardId})`;
/** Matches teamBoardSource, and the earlier import's "Team board import (id)". */
export const TEAM_BOARD_SOURCE = /^Team board(?: import)? \(([^()]+)\)$/;

export interface TrailEntry {
  id: string;
  /** The Task this entry belongs to, so a Task's Trail is one indexed read. */
  taskId: string | null;
  companyId: string;
  subject: "task" | "document" | "area" | "project";
  subjectId: string;
  memberId: string;
  action: string;
  field: string | null;
  old: string | null;
  new: string | null;
  via: Via;
  at: string;
  outcome: "ok" | "failed";
}

export function departmentName(id: DepartmentId): string {
  return DEPARTMENTS.find((d) => d.id === id)?.name ?? id;
}

export function isDepartmentId(value: string): value is DepartmentId {
  return DEPARTMENTS.some((d) => d.id === value);
}

export function isMember(person: Pick<Person, "kind">): boolean {
  return person.kind === "member";
}

export function canBeShared(departmentId: DepartmentId): boolean {
  return !NEVER_SHARED.includes(departmentId);
}

/** Whether this Person may see this Task at all. Members see everything; a Company team sees its Company's Shared Tasks. */
export function canSee(person: Person, task: Task): boolean {
  if (isMember(person)) return true;
  return task.shared && !task.removed && task.companyId === person.companyId && canBeShared(task.departmentId);
}

/** Progress of a Project: its Done Tasks out of all its Tasks, leaving out removed ones. */
export function progress(tasks: Task[]): { done: number; total: number } {
  const counted = tasks.filter((t) => !t.removed);
  return { done: counted.filter((t) => t.status === "done").length, total: counted.length };
}

/** Whether a Task has any Owner, on the board or typed by name. */
export function hasOwner(task: Pick<Task, "ownerIds" | "ownerNames">): boolean {
  return task.ownerIds.length > 0 || task.ownerNames.length > 0;
}

export function isOpen(task: Task): boolean {
  return !task.removed && task.status !== "done";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}
