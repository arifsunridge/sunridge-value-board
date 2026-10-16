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
    default:
      return `${who} changed the ${FIELD_LABELS[entry.field ?? ""] ?? entry.field} from ${v(entry.old)} to ${v(entry.new)}${via}`;
  }
}
