import type { Person, Task, TrailEntry } from "@/board/model";
import { DOCUMENT_STATUS_LABELS, PHASE_LABELS, PRIORITY_LABELS, STATUS_LABELS, departmentName, initials, isDepartmentId } from "@/board/model";
import { People } from "@/board/people";

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export function formatDay(iso: string): string {
  return day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

export function formatWhen(iso: string): string {
  return dayTime.format(new Date(iso));
}

export function peopleInitials(ids: string[], members: Person[]): string {
  return ids.map((id) => initials(members.find((m) => m.id === id)?.name ?? "?")).join(" ");
}

export function peopleNames(ids: string[], members: Person[]): string {
  return new People(members).names(ids).join(", ");
}

/**
 * Short names for a card: first names, or first name and last initial where two of these share
 * a first name. The full names go in the card's title and for screen readers.
 */
export function shortNames(names: string[]): string[] {
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
  return names.map((n) => {
    const f = first(n);
    const parts = n.trim().split(/\s+/);
    const clash = names.some((o) => o !== n && first(o) === f);
    return clash && parts.length > 1 ? `${f} ${parts[parts.length - 1]![0]}.` : f;
  });
}

/** Every Owner of a Task as a name: People on the board, then names typed for anyone else. */
export function ownerNames(task: Pick<Task, "ownerIds" | "ownerNames">, members: Person[]): string[] {
  return new People(members).ownerNames(task);
}

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  status: "status",
  priority: "priority",
  ownerIds: "Owners",
  ownerNames: "Owners typed by name",
  contributorIds: "Contributors",
  companyOwner: "company owner",
  projectId: "Project",
  goal: "goal",
  ownerId: "Owner",
  ownerName: "Owner",
  phase: "Phase",
  repository: "repository",
  portalApp: "Portal app",
  liveUrl: "live address",
  order: "order",
  due: "due date",
  note: "note",
  companyId: "company",
  departmentId: "Department",
  areaId: "Area",
  name: "name",
  url: "link",
};

function value(field: string | null, raw: string | null, members: Person[], names: Record<string, string>): string {
  if (raw === null || raw === "") return "nothing";
  if (field === "status") return STATUS_LABELS[raw as keyof typeof STATUS_LABELS] ?? raw;
  if (field === "priority") return PRIORITY_LABELS[raw as keyof typeof PRIORITY_LABELS] ?? raw;
  if (field === "ownerIds" || field === "contributorIds" || field === "ownerId") return peopleNames(raw.split(","), members);
  if (field === "ownerNames") return raw.split(",").join(", ");
  if (field === "phase") return PHASE_LABELS[raw as keyof typeof PHASE_LABELS] ?? raw;
  if (field === "due") return formatDay(raw);
  if (field === "departmentId" && isDepartmentId(raw)) return departmentName(raw);
  if (field === "status" || field === "name") return raw;
  if (field === "companyId" || field === "areaId" || field === "projectId") return names[raw] ?? raw;
  if (DOCUMENT_STATUS_LABELS[raw as keyof typeof DOCUMENT_STATUS_LABELS]) return DOCUMENT_STATUS_LABELS[raw as keyof typeof DOCUMENT_STATUS_LABELS];
  return `“${raw}”`;
}

const VIA: Record<TrailEntry["via"], string> = { screen: "", capture: " from meeting notes", claude: " via Claude", import: " from the prototype import", sync: " from the team board" };

/** One plain-English line per Trail entry. */
export function describe(entry: TrailEntry, members: Person[], names: Record<string, string> = {}): string {
  const who = members.find((m) => m.id === entry.memberId)?.name ?? "Someone no longer on the board";
  const via = VIA[entry.via];
  const v = (raw: string | null) => value(entry.field, raw, members, names);
  if (entry.subject === "project") {
    if (entry.action === "created") return `${who} added the Project ${entry.new}${via}${entry.old ? ` (${entry.old})` : ""}`;
    if (entry.action === "removed") return `${who} removed this Project${via}`;
    if (entry.action === "restored") return `${who} restored this Project${via}`;
    return `${who} changed the Project's ${FIELD_LABELS[entry.field ?? ""] ?? entry.field} from ${v(entry.old)} to ${v(entry.new)}${via}`;
  }
  if (entry.subject === "area") {
    if (entry.action === "created") return `${who} added the Area ${entry.new}${via}`;
    if (entry.action === "retired") return `${who} retired the Area ${entry.new}${via}`;
    return `${who} renamed an Area from ${entry.old} to ${entry.new}${via}`;
  }
  if (entry.subject === "document") {
    switch (entry.action) {
      case "added":
        return `${who} added the Document “${entry.new}”${via}`;
      case "new_version":
        return `${who} uploaded a new Version of “${entry.new}”${via}`;
      case "replaced":
        return `${who} replaced a Document's link${via} (was ${entry.old})`;
      case "moved_out":
        return `${who} moved a Document to “${entry.new}”${via}`;
      case "moved_in":
        return `${who} moved a Document here from “${entry.old}”${via}`;
      case "removed":
        return `${who} removed the Document “${entry.new}”${via} (last link ${entry.old})`;
      case "restored":
        return `${who} restored the Document “${entry.new}”${via}`;
      default:
        return `${who} changed a Document's ${FIELD_LABELS[entry.field ?? ""] ?? entry.field} from ${v(entry.old)} to ${v(entry.new)}${via}`;
    }
  }
  switch (entry.action) {
    case "created":
      return `${who} added this Task${via}${entry.old ? ` (${entry.old})` : ""}`;
    case "removed":
      return `${who} removed this Task${via}`;
    case "restored":
      return `${who} restored this Task${via}`;
    case "joined":
      return `${who} joined as a Contributor${via}`;
    case "shared":
      return `${who} shared this Task with the company team${via}`;
    case "unshared":
      return `${who} stopped sharing this Task with the company team${via}`;
    case "made_private":
      return `${who} made this Task private${via}`;
    case "opened":
      return `${who} opened this Task to Sunridge${via}`;
    default:
      return `${who} changed the ${FIELD_LABELS[entry.field ?? ""] ?? entry.field} from ${v(entry.old)} to ${v(entry.new)}${via}`;
  }
}

/**
 * Whose Tasks the board shows: `p:<id>` a Person who owns or contributes, `n:<name>` a name typed
 * as an Owner, `c:<name>` the company owner. Anything else is anyone.
 */
export function ownerMatches(owner: string | undefined, task: Pick<Task, "ownerIds" | "contributorIds" | "ownerNames" | "companyOwner">): boolean {
  const kind = owner?.slice(0, 2);
  const value = owner?.slice(2) ?? "";
  const same = (a: string) => a.trim().toLowerCase() === value.trim().toLowerCase();
  if (kind === "p:") return task.ownerIds.includes(value) || task.contributorIds.includes(value);
  if (kind === "n:") return task.ownerNames.some(same);
  if (kind === "c:") return same(task.companyOwner ?? "");
  return true;
}

export interface OwnerOption {
  value: string;
  label: string;
  count: number;
}

/** The people the board's Owner picker offers, from the Tasks on it: Sunridge, the company's people and owners, and typed names. */
export function ownerOptions(
  tasks: Pick<Task, "ownerIds" | "contributorIds" | "ownerNames" | "companyOwner">[],
  members: Person[],
): { sunridge: OwnerOption[]; company: OwnerOption[]; others: OwnerOption[] } {
  const people = new People(members);
  const counts = new Map<string, number>();
  const add = (value: string) => counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const t of tasks) {
    new Set([...t.ownerIds, ...t.contributorIds]).forEach((id) => add(`p:${id}`));
    new Set(t.ownerNames.map((n) => n.trim())).forEach((n) => add(`n:${n}`));
    if (t.companyOwner?.trim()) add(`c:${t.companyOwner.trim()}`);
  }
  const sunridge: OwnerOption[] = [];
  const company: OwnerOption[] = [];
  const others: OwnerOption[] = [];
  for (const [value, count] of counts) {
    const kind = value.slice(0, 2);
    const rest = value.slice(2);
    if (kind === "p:") (people.get(rest)?.kind === "company" ? company : sunridge).push({ value, label: people.name(rest), count });
    else if (kind === "c:") company.push({ value, label: rest, count });
    else others.push({ value, label: rest, count });
  }
  const byLabel = (a: OwnerOption, b: OwnerOption) => a.label.localeCompare(b.label);
  return { sunridge: sunridge.sort(byLabel), company: company.sort(byLabel), others: others.sort(byLabel) };
}
