import type { Actor, Board } from "@/board/board";
import { teamBoardSource, type Area, type Task } from "@/board/model";
import { BoardError } from "@/board/rules";
import type { BoardSide, SyncPlan } from "./plan";

/** Everything the board holds that the sync compares, read as the syncing Member. */
export async function readBoardSide(board: Board, actor: Actor): Promise<BoardSide> {
  const companies = await board.companies(actor);
  const areas: Area[] = [];
  const tasks: Task[] = [];
  for (const company of companies) {
    const [view, removed] = await Promise.all([board.board(actor, company.id), board.removedTasks(actor, company.id)]);
    areas.push(...view.areas);
    tasks.push(...view.tasks, ...removed);
  }
  const people = (await board.people(actor)).map((p) => p.id);
  return { companies, areas, tasks, links: await board.teamBoardLinks(actor), people };
}

export interface ApplyResult {
  created: number;
  updated: number;
  /** Came in as Next because the Company's Now was full. */
  notInNow: number;
  failed: { id: string; reason: string }[];
}

/**
 * Makes the board changes in a plan through the same operations as the screen, so every rule
 * applies and every change is on the Trail ("sync"). One Task failing never stops the rest.
 */
export async function applyBoardChanges(board: Board, actor: Actor, plan: SyncPlan, side: BoardSide): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, updated: 0, notInNow: 0, failed: [] };
  const areaId = async (companyId: string, departmentId: string, name: string | null): Promise<string | null> => {
    if (!name) return null;
    const found = side.areas.find((a) => a.companyId === companyId && a.departmentId === departmentId && a.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const area = await board.createArea(actor, { companyId, departmentId, name });
    side.areas.push(area);
    return area.id;
  };

  for (const op of plan.board) {
    try {
      const s = op.shape;
      if (op.kind === "create") {
        const home = { companyId: s.companyId, departmentId: s.departmentId, areaId: await areaId(s.companyId, s.departmentId, s.areaName) };
        const create = (status: Task["status"]) =>
          board.createTask(actor, {
            ...home,
            title: s.title,
            priority: s.priority,
            status,
            ownerIds: s.ownerIds,
            due: s.due,
            note: status === "blocked" ? s.note || "See the team board" : s.note,
            source: teamBoardSource(op.teamBoardId),
            documents: op.documents,
          });
        const task = await create(s.status).catch(async (error) => {
          if (!(error instanceof BoardError && error.code === "now_cap")) throw error;
          result.notInNow++;
          return create("next");
        });
        if (s.removed) await board.removeTask(actor, task.id);
        result.created++;
        continue;
      }

      const fields = new Set(op.fields);
      if (fields.has("removed") && s.removed) {
        await board.removeTask(actor, op.taskId);
        result.updated++;
        continue;
      }
      if (fields.has("removed") && !s.removed) await board.restoreTask(actor, op.taskId);
      if (fields.has("status") || fields.has("home")) {
        await board.moveTask(actor, op.taskId, {
          status: s.status,
          ...(fields.has("home") ? { departmentId: s.departmentId, areaId: await areaId(s.companyId, s.departmentId, s.areaName) } : {}),
          waitingOn: s.status === "blocked" ? s.note || "See the team board" : undefined,
        });
      }
      const changes = {
        ...(fields.has("title") ? { title: s.title } : {}),
        ...(fields.has("priority") ? { priority: s.priority } : {}),
        ...(fields.has("ownerIds") ? { ownerIds: s.ownerIds } : {}),
        ...(fields.has("due") ? { due: s.due } : {}),
        ...(fields.has("note") && !(fields.has("status") && s.status === "blocked") ? { note: s.note } : {}),
      };
      if (Object.keys(changes).length) await board.updateTask(actor, op.taskId, changes);
      result.updated++;
    } catch (error) {
      if (!(error instanceof BoardError)) throw error;
      result.failed.push({ id: op.teamBoardId, reason: error.message });
    }
  }
  return result;
}
