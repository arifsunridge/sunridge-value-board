// Turns a prototype board backup into reviewable Tasks (spec P0.14).
// Pure functions only, so they can be tested with invented data.

import { TITLE_MAX_WORDS, isDepartmentId, type DepartmentId, type Priority, type Status } from "@/board/model";
import { words } from "@/board/rules";

export interface Backup {
  categories: Record<string, { name: string; parentId: string | null; projectId: string | null }>;
  actions: Record<
    string,
    {
      title: string;
      status: string;
      categoryId?: string | null;
      projectId: string;
      due?: string | null;
      ownerId?: string | null;
      impact?: number;
      urgency?: number;
      effort?: number;
    }
  >;
}

export interface ReviewItem {
  prototypeId: string;
  company: string;
  departmentId: DepartmentId;
  area: string | null;
  title: string;
  originalTitle: string;
  priority: Priority;
  status: Status;
  ownerIds: string[];
  contributorIds: string[];
  due: string | null;
  /** Reasons Arif must look at this one before it is imported. */
  check: string[];
  /** Set to true once reviewed; only approved items are imported. */
  approved: boolean;
}

const DEPARTMENTS: Record<string, DepartmentId> = {
  "d-strategy": "strategy",
  "d-sales": "sales",
  "d-operations": "operations",
  "d-talent": "talent",
  "d-innovation": "innovation",
  "d-finance": "finance",
};

/** Splits "Data pack — owner: Theran, Arif (GL analysis)" into a title and first names. */
export function splitOwners(title: string): { title: string; names: string[] } {
  const match = title.match(/^(.*?)\s*[—–-]\s*owners?\s*:\s*(.+)$/i);
  if (!match) return { title: title.trim(), names: [] };
  const names = match[2]!
    .replace(/\([^)]*\)/g, "")
    .split(/,|\band\b|&/)
    .map((n) => n.trim())
    .filter(Boolean);
  return { title: match[1]!.trim(), names };
}

export function prepare(
  backup: Backup,
  options: { members: Record<string, string>; companies: Record<string, string> },
): ReviewItem[] {
  const memberByName = new Map(Object.entries(options.members).map(([name, id]) => [name.toLowerCase(), id]));
  return Object.entries(backup.actions).map(([id, a]) => {
    const check: string[] = [];
    const category = a.categoryId ? backup.categories[a.categoryId] : undefined;
    const isArea = Boolean(category?.parentId);
    const deptKey = isArea ? category!.parentId! : (a.categoryId ?? "");
    let departmentId = DEPARTMENTS[deptKey];
    if (!departmentId || !isDepartmentId(departmentId)) {
      departmentId = "strategy";
      check.push("No Department in the prototype: placed under Strategic planning.");
    }

    const { title: bare, names } = splitOwners(a.title);
    const ids = names.map((n) => memberByName.get(n.split(/\s+/)[0]!.toLowerCase()));
    if (ids.some((x) => !x)) check.push(`Unknown name in title: ${names.filter((_, i) => !ids[i]).join(", ")}.`);
    const people = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (a.ownerId && options.members[a.ownerId]) people.unshift(options.members[a.ownerId]!);
    const [owner, ...contributors] = [...new Set(people)];
    if (!owner) check.push("No Owner: choose one.");
    else if (contributors.length) check.push("First name became the Owner, the rest Contributors: check.");

    let title = words(bare).join(" ");
    if (words(title).length > TITLE_MAX_WORDS) {
      title = words(title).slice(0, TITLE_MAX_WORDS).join(" ");
      check.push("Title cut to 8 words: rewrite it.");
    }
    check.push("Apply the one-week slip test: imported as Medium.");

    return {
      prototypeId: id,
      company: options.companies[a.projectId] ?? a.projectId,
      departmentId,
      area: isArea ? category!.name : null,
      title,
      originalTitle: a.title,
      priority: "medium",
      status: a.status === "now" || a.status === "blocked" || a.status === "done" ? a.status : "next",
      ownerIds: owner ? [owner] : [],
      contributorIds: contributors,
      due: a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null,
      check,
      approved: false,
    };
  });
}
