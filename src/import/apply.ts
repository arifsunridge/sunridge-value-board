import type { Actor, Board } from "@/board/board";
import { NOTE_MAX_CHARS, type DepartmentId, type Status } from "@/board/model";
import { BoardError } from "@/board/rules";
import type { ReviewItem } from "./review";

export interface ImportResult {
  imported: { title: string; company: string }[];
  /** Imported, but left in Next because the company's Now was full. */
  notInNow: string[];
  skipped: { title: string; reason: string }[];
}

/**
 * Puts approved review items on the board, as the importing Member, through the same
 * operations as the screen: every rule applies and every change is on the Trail ("import").
 * Each Task is created with its Status and Documents in one step, so the importer needn't own it.
 * One item failing never stops the rest. A Task already on the board with the same title
 * in the same company is skipped, so running the import twice adds nothing.
 */
export async function applyReview(board: Board, actor: Actor, items: ReviewItem[]): Promise<ImportResult> {
  const result: ImportResult = { imported: [], notInNow: [], skipped: [] };
  const companies = await board.companies(actor);
  for (const item of items.filter((i) => i.approved)) {
    try {
      const company = companies.find((c) => c.name.toLowerCase() === item.company.toLowerCase());
      if (!company) {
        result.skipped.push({ title: item.title, reason: `No company called ${item.company} on the board.` });
        continue;
      }
      const view = await board.board(actor, company.id);
      if (view.tasks.some((t) => t.title.toLowerCase() === item.title.toLowerCase())) {
        result.skipped.push({ title: item.title, reason: "Already on the board." });
        continue;
      }
      const departmentId = item.departmentId as DepartmentId;
      let areaId: string | null = null;
      if (item.area) {
        areaId =
          view.areas.find((a) => a.departmentId === departmentId && a.name.toLowerCase() === item.area!.toLowerCase())?.id ??
          (await board.createArea(actor, { companyId: company.id, departmentId, name: item.area })).id;
      }
      const note = (item.note ?? "").slice(0, NOTE_MAX_CHARS);
      const create = (status: Status) =>
        board.createTask(actor, {
          companyId: company.id,
          departmentId,
          areaId,
          title: item.title,
          priority: item.priority,
          status,
          ownerIds: item.ownerIds,
          contributorIds: item.contributorIds,
          due: item.due,
          note: status === "blocked" ? note || "Check after import" : note,
          source: `Team board import (${item.prototypeId})`,
          documents: item.documents ?? [],
        });
      try {
        await create(item.status);
      } catch (error) {
        // The cap counts every Task in Now; one that doesn't fit comes in as Next.
        if (!(error instanceof BoardError && error.code === "now_cap")) throw error;
        await create("next");
        result.notInNow.push(item.title);
      }
      result.imported.push({ title: item.title, company: company.name });
    } catch (error) {
      if (!(error instanceof BoardError)) throw error;
      result.skipped.push({ title: item.title, reason: error.message });
    }
  }
  return result;
}
