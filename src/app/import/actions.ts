"use server";

import { revalidatePath } from "next/cache";
import { isMember } from "@/board/model";
import { BoardError } from "@/board/rules";
import { applyReview, type ImportResult } from "@/import/apply";
import { reviewFileSchema } from "@/import/review";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";

/** Imports the reviewed Tasks a Member ticked, as that Member (spec P0.14). */
export async function importReview(items: unknown): Promise<{ ok: true; result: ImportResult } | { ok: false; message: string }> {
  const me = await requirePerson("/import");
  if (!isMember(me)) return { ok: false, message: "Importing is for Sunridge Members." };
  const parsed = reviewFileSchema.safeParse(items);
  if (!parsed.success) return { ok: false, message: "That file isn't a review file from the import. Prepare it again." };
  try {
    const result = await applyReview(board(), { memberId: me.id, via: "import" }, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof BoardError) return { ok: false, message: error.message };
    // Never log Task content (ADR 0002): the error's name only.
    console.error("Import failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, message: "The import stopped partway. Run it again: Tasks already on the board are skipped." };
  }
}
