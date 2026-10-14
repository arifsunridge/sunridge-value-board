// Turns an export of the "Sunridge team board" Claude artifact into reviewable Tasks (spec P0.14).
// Pure functions only, so they can be tested with invented data.

import {
  NOTE_MAX_CHARS,
  NOTE_MAX_LINES,
  PRIORITIES,
  STATUSES,
  TITLE_MAX_WORDS,
  isDepartmentId,
  type DepartmentId,
  type DocumentStatus,
  type Priority,
  type Status,
} from "@/board/model";
import { words } from "@/board/rules";
import type { ReviewItem } from "./review";

/** The artifact's collections, keyed by document id, as its database export saves them. */
export interface TeamBoardExport {
  projects: Record<string, { name: string }>;
  categories: Record<string, { name: string; parentId: string | null; projectId: string | null }>;
  actions: Record<
    string,
    {
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
    }
  >;
  documents?: Record<string, { taskId?: string | null; kind: string; status: string; title: string; url: string; removed?: boolean }>;
}

export interface TeamBoardOptions {
  /** The artifact's user ids ("u_…") to people's emails, which are their ids on the board. */
  people: Record<string, string>;
  /** People whose mapping is a best guess: their Tasks are flagged for a check. */
  guessed?: string[];
  /** Artifact project ids to the board's company names, e.g. { "p-hbf": "HBF" }. */
  companies: Record<string, string>;
}

const DOCUMENT_STATUS: Record<string, DocumentStatus> = { draft: "draft", review: "in_review", in_review: "in_review", final: "final" };

/** Keeps a note within the board's limit (2 lines, 200 characters), cutting at a word. */
export function shortNote(text: string): { note: string; cut: boolean } {
  const clean = text.replace(/\r\n/g, "\n").trim();
  const lines = clean.split("\n").filter((l) => l.trim());
  let note = lines.slice(0, NOTE_MAX_LINES).join("\n");
  let cut = lines.length > NOTE_MAX_LINES;
  if (note.length > NOTE_MAX_CHARS) {
    const room = note.slice(0, NOTE_MAX_CHARS - 1);
    note = `${room.slice(0, Math.max(room.lastIndexOf(" "), 1)).trimEnd()}…`;
    cut = true;
  }
  return { note, cut };
}

export function prepareTeamBoard(data: TeamBoardExport, options: TeamBoardOptions): ReviewItem[] {
  const docsByTask = new Map<string, NonNullable<ReviewItem["documents"]>>();
  for (const d of Object.values(data.documents ?? {})) {
    if (!d.taskId || d.removed || !/^https:\/\//.test(d.url) || (d.kind !== "claude" && d.kind !== "link")) continue;
    const list = docsByTask.get(d.taskId) ?? [];
    list.push({ kind: d.kind, name: d.title.slice(0, 120), url: d.url, status: DOCUMENT_STATUS[d.status] ?? "draft" });
    docsByTask.set(d.taskId, list);
  }

  return Object.entries(data.actions)
    .filter(([, a]) => !a.removed)
    .map(([id, a]) => {
      const check: string[] = [];
      const category = a.categoryId ? data.categories[a.categoryId] : undefined;
      const isArea = Boolean(category?.parentId);
      const deptKey = (isArea ? category!.parentId! : (a.categoryId ?? "")).replace(/^d-/, "");
      let departmentId: DepartmentId = "strategy";
      if (isDepartmentId(deptKey)) departmentId = deptKey;
      else check.push("No Department on the team board: placed under Strategic planning.");

      const ownerIds: string[] = [];
      for (const u of a.ownerIds ?? []) {
        const email = options.people[u];
        if (email) ownerIds.push(email);
        else check.push(`Unknown person ${u}: choose the Owner.`);
        if (options.guessed?.includes(u)) check.push(`Owner ${email ?? u} is a best guess: check.`);
      }
      if (!ownerIds.length) check.push("No Owner: choose one.");

      let title = words(a.title).join(" ");
      if (words(title).length > TITLE_MAX_WORDS) {
        title = words(title).slice(0, TITLE_MAX_WORDS).join(" ");
        check.push("Title cut to 8 words: rewrite it.");
      }

      const status: Status = (STATUSES as readonly string[]).includes(a.status) ? (a.status as Status) : "next";
      const priority: Priority = (PRIORITIES as readonly string[]).includes(a.priority ?? "") ? (a.priority as Priority) : "medium";
      const { note, cut } = shortNote(status === "blocked" ? a.waitingOn || a.note || "" : a.note || "");
      if (cut) check.push("Note shortened to 2 lines: the full note stays on the team board.");

      return {
        prototypeId: id,
        company: options.companies[a.projectId] ?? a.projectId,
        departmentId,
        area: isArea ? category!.name : null,
        title,
        originalTitle: a.title,
        priority,
        status,
        ownerIds: [...new Set(ownerIds)],
        contributorIds: [],
        due: a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null,
        note,
        documents: docsByTask.get(id) ?? [],
        check,
        // Items with nothing to check start ticked; a Member still reviews every one on the import screen.
        approved: check.length === 0,
      };
    })
    .sort((x, y) => x.company.localeCompare(y.company) || x.departmentId.localeCompare(y.departmentId) || x.title.localeCompare(y.title));
}
