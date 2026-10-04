import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  DEPARTMENTS,
  PRIORITIES,
  PRIORITY_RULE,
  TITLE_MAX_WORDS,
  type Area,
  type Company,
  type DepartmentId,
  type Member,
  type Priority,
} from "@/board/model";
import { words } from "@/board/rules";

/** A proposed Task. It isn't on the board until a Member confirms it. */
export interface Suggestion {
  title: string;
  departmentId: DepartmentId;
  areaId: string | null;
  priority: Priority;
  ownerIds: string[];
  due: string | null;
  note: string;
}

export const MODEL = "claude-opus-5-5";

const departmentIds = DEPARTMENTS.map((d) => d.id) as [DepartmentId, ...DepartmentId[]];

const schema = z.object({
  suggestions: z.array(
    z.object({
      title: z.string().describe(`At most ${TITLE_MAX_WORDS} words, starting with a verb. No people's names.`),
      departmentId: z.enum(departmentIds),
      areaId: z.string().nullable().describe("An Area ID from the list, or null for the whole Department."),
      priority: z.enum(PRIORITIES),
      ownerIds: z.array(z.string()).describe("Member IDs from the list. Empty if no Member clearly owns it."),
      due: z.string().nullable().describe("YYYY-MM-DD if the notes give or clearly imply a date, otherwise null."),
      note: z.string().describe("Optional context, one short line. Empty string if none."),
    }),
  ),
});

export function systemPrompt(): string {
  return [
    "You turn a private equity team's meeting notes into proposed Tasks for their value creation board.",
    "A person reviews every proposal before it reaches the board, so propose only clear actions and skip discussion, background and decisions with no follow-up.",
    "",
    "Rules for each Task:",
    `- Title: at most ${TITLE_MAX_WORDS} words, starting with a verb ("Confirm…", "Draft…", "Analyze…"). Never put people's names or "owner" in the title.`,
    "- Owners: only IDs from the Members list. If the action belongs to someone outside the team (for example company staff), give it to the Member who will follow it up, or leave it empty if that isn't clear.",
    "- Home: one Department, and an Area from the list only when the notes clearly point to it.",
    "- Priority, by the one-week slip test:",
    `  - high: ${PRIORITY_RULE.high}`,
    `  - medium: ${PRIORITY_RULE.medium}`,
    `  - low: ${PRIORITY_RULE.low}`,
    "  High should be rare. When unsure, choose medium.",
    "- Due: only when the notes give or clearly imply a date. Resolve relative dates against the meeting date.",
    "- Note: at most one short line of context that the title can't carry. Don't repeat figures you aren't sure of.",
    "- Merge duplicates. Split an item that is really two actions with different owners.",
  ].join("\n");
}

export function userPrompt(input: { company: Company; areas: Area[]; members: Member[]; meetingDate: string; notes: string }): string {
  const departments = DEPARTMENTS.map((d) => {
    const areas = input.areas.filter((a) => a.departmentId === d.id && !a.retired);
    return `- ${d.id} (${d.name})${areas.length ? `: ${areas.map((a) => `${a.id} = ${a.name}`).join("; ")}` : ""}`;
  });
  return [
    `Company: ${input.company.name}. Write titles and notes in ${input.company.english === "US" ? "US" : "British"} English.`,
    `Meeting date: ${input.meetingDate}.`,
    "",
    "Members (the only possible Owners):",
    ...input.members.map((m) => `- ${m.id} = ${m.name}`),
    "",
    "Departments and their Areas:",
    ...departments,
    "",
    "<meeting_notes>",
    input.notes,
    "</meeting_notes>",
  ].join("\n");
}

export class CaptureError extends Error {}

/** Asks Claude for Suggestions. The notes go in the request only; they are never stored or logged. */
export async function suggestTasks(
  client: Anthropic,
  input: { company: Company; areas: Area[]; members: Member[]; meetingDate: string; notes: string },
): Promise<Suggestion[]> {
  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(),
    messages: [{ role: "user", content: userPrompt(input) }],
  });
  if (message.stop_reason === "refusal") throw new CaptureError("Claude declined these notes. Add the Tasks by hand.");
  if (message.stop_reason === "max_tokens" || !message.parsed_output) {
    throw new CaptureError("Those notes were too long to turn into Tasks in one go. Try pasting them in parts.");
  }
  return clean(message.parsed_output.suggestions, input);
}

/** Keeps only what the board can accept: known Members and Areas, real dates. Long titles stay for the person to fix. */
export function clean(
  suggestions: z.infer<typeof schema>["suggestions"],
  input: { areas: Area[]; members: Member[] },
): Suggestion[] {
  const memberIds = new Set(input.members.map((m) => m.id));
  return suggestions.map((s) => {
    const area = input.areas.find((a) => a.id === s.areaId && !a.retired);
    return {
      title: words(s.title).join(" "),
      departmentId: area?.departmentId ?? s.departmentId,
      areaId: area?.id ?? null,
      priority: s.priority,
      ownerIds: [...new Set(s.ownerIds.filter((id) => memberIds.has(id)))],
      due: s.due && /^\d{4}-\d{2}-\d{2}$/.test(s.due) && !Number.isNaN(Date.parse(s.due)) ? s.due : null,
      note: s.note.trim().split("\n")[0]!.slice(0, 200),
    };
  });
}
