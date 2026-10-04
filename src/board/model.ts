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

export const NOW_CAP = 5;
export const HIGH_SHARE_WARNING = 0.25;
export const TITLE_MAX_WORDS = 8;
export const NOTE_MAX_CHARS = 200;
export const NOTE_MAX_LINES = 2;

export interface Member {
  id: string; // Entra object ID
  name: string;
  email: string;
}

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
  ownerIds: string[];
  contributorIds: string[];
  /** ISO date, YYYY-MM-DD. */
  due: string | null;
  note: string;
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

export type Via = "screen" | "capture" | "claude" | "import";

export interface TrailEntry {
  id: string;
  /** The Task this entry belongs to, so a Task's Trail is one indexed read. */
  taskId: string | null;
  companyId: string;
  subject: "task" | "document" | "area";
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
