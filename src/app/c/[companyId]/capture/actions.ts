"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { BoardError } from "@/board/rules";
import { CaptureError, suggestTasks, type Suggestion } from "@/capture/capture";
import { config } from "@/server/config";
import { board } from "@/server/context";
import { requireMember } from "@/server/session";
import { formatDay } from "@/ui/format";

const MAX_NOTES = 60_000;

export async function suggest(
  companyId: string,
  meetingDate: string,
  notes: string,
): Promise<{ ok: true; suggestions: Suggestion[] } | { ok: false; message: string }> {
  await requireMember();
  const c = config();
  if (c.CAPTURE_ENABLED !== "true") return { ok: false, message: "Capture is switched off for now. Add Tasks from the board." };
  if (!notes.trim()) return { ok: false, message: "Paste the meeting notes first." };
  if (notes.length > MAX_NOTES) return { ok: false, message: "Those notes are very long. Paste them in parts." };
  const b = board();
  try {
    const [company, view, members] = await Promise.all([b.company(companyId), b.board(companyId), b.members()]);
    const suggestions = await suggestTasks(new Anthropic({ apiKey: c.ANTHROPIC_API_KEY }), {
      company,
      areas: view.areas,
      members,
      meetingDate,
      notes,
    });
    return { ok: true, suggestions };
  } catch (error) {
    if (error instanceof CaptureError || error instanceof BoardError) return { ok: false, message: error.message };
    // Never log the notes or the response (ADR 0002).
    console.error("Capture failed:", error instanceof Error ? error.name : "unknown", (error as { status?: number }).status ?? "");
    return { ok: false, message: "Capture didn't work this time. Try again, or add the Tasks by hand." };
  }
}

export async function confirm(
  companyId: string,
  meetingDate: string,
  s: Suggestion,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await requireMember();
  try {
    await board().createTask(
      { memberId: me.id, via: "capture" },
      { companyId, ...s, source: `Meeting notes, ${formatDay(meetingDate)}` },
    );
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof BoardError) return { ok: false, message: error.message };
    console.error("Confirm failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, message: "That didn't save. Try again in a moment." };
  }
}
