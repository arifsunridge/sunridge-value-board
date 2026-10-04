import { NOTE_MAX_CHARS, NOTE_MAX_LINES, TITLE_MAX_WORDS } from "./model";

export type BoardErrorCode =
  | "not_found"
  | "not_allowed"
  | "invalid"
  | "now_cap"
  | "waiting_on_required";

/** A rule was broken. The message is plain British English, ready to show on screen. */
export class BoardError extends Error {
  constructor(
    readonly code: BoardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BoardError";
  }
}

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function cleanTitle(title: string): string {
  const clean = words(title).join(" ");
  if (!clean) throw new BoardError("invalid", "A Task needs a title.");
  if (words(clean).length > TITLE_MAX_WORDS) {
    throw new BoardError("invalid", `Keep the title to ${TITLE_MAX_WORDS} words or fewer.`);
  }
  return clean;
}

export function cleanNote(note: string | undefined | null): string {
  const clean = (note ?? "").replace(/\r\n/g, "\n").trim();
  if (clean.length > NOTE_MAX_CHARS) {
    throw new BoardError("invalid", `Keep the note to ${NOTE_MAX_CHARS} characters or fewer.`);
  }
  if (clean.split("\n").length > NOTE_MAX_LINES) {
    throw new BoardError("invalid", `Keep the note to ${NOTE_MAX_LINES} lines.`);
  }
  return clean;
}

export function cleanDue(due: string | undefined | null): string | null {
  if (!due) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`))) {
    throw new BoardError("invalid", "The due date isn't a real date.");
  }
  return due;
}

export function cleanName(name: string, what: string, max = 120): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new BoardError("invalid", `${what} needs a name.`);
  if (clean.length > max) throw new BoardError("invalid", `Keep the name to ${max} characters or fewer.`);
  return clean;
}

export function cleanUrl(url: string): string {
  const clean = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new BoardError("invalid", "That link isn't a web address.");
  }
  if (parsed.protocol !== "https:") {
    throw new BoardError("invalid", "Links must start with https://.");
  }
  return parsed.toString();
}

// Common opening verbs for work Tasks. Used only for a gentle prompt, never to block.
const VERBS = new Set(
  `add agree align analyse analyze approve arrange assess audit book brief build calculate call capture
  chase check circulate clarify close collect compare complete confirm consolidate contact cost create
  decide define deliver design develop document draft engage escalate establish estimate evaluate
  expand explore extend file finalise finalize find fix follow forecast gather get hire hold identify
  implement improve interview introduce investigate issue launch lead list load map measure meet merge
  migrate model monitor move negotiate onboard open order organise organize pilot plan prepare present
  price prioritise prioritize produce propose publish quantify raise rebuild recommend reconcile record
  reduce refresh renew replace report request research resolve review revise roll run schedule scope
  secure select send set settle share sign simplify source spec specify start streamline submit
  summarise summarize support survey switch take test track train transfer transition update upgrade
  validate verify visit walk write`.split(/\s+/),
);

/** Gentle prompts for a title that follows the rules but could be clearer. */
export function titleHints(title: string): string[] {
  const hints: string[] = [];
  const first = words(title)[0]?.toLowerCase().replace(/[^a-z]/g, "");
  if (first && !VERBS.has(first)) hints.push("Start with a verb, for example “Confirm…” or “Draft…”.");
  if (/\bowners?\s*:/i.test(title)) hints.push("Put people in Owners, not in the title.");
  return hints;
}
