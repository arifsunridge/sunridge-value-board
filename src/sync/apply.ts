import type { Actor, Board } from "@/board/board";
import { teamBoardSource, type Area, type Project, type ProjectUpdate, type Task } from "@/board/model";
import { People } from "@/board/people";
import { BoardError } from "@/board/rules";
import type { BoardSide, SyncConfig, SyncPlan } from "./plan";

/** Everything the board holds that the sync compares, read as the syncing Member. */
export async function readBoardSide(board: Board, actor: Actor): Promise<BoardSide> {
  const companies = await board.companies(actor);
  const areas: Area[] = [];
  const tasks: Task[] = [];
  const projects: Project[] = [];
  const updates: ProjectUpdate[] = [];
  for (const company of companies) {
    const [view, removed, all] = await Promise.all([
      board.board(actor, company.id),
      board.removedTasks(actor, company.id),
      board.allProjects(actor, company.id),
    ]);
    areas.push(...view.areas);
    tasks.push(...view.tasks, ...removed);
    projects.push(...all.projects);
    updates.push(...all.updates);
  }
  const { ownersFromSync, setOnBoard, ...links } = await board.teamBoardLinks(actor);
  // A stand-in: the syncing Member alone, put there by the sync and never changed by a person.
  const standIns = new Set(tasks.filter((t) => ownersFromSync.has(t.id) && t.ownerIds.join() === actor.memberId && !t.ownerNames.length).map((t) => t.id));
  return { companies, areas, tasks, projects, updates, links, standIns, setOnBoard, people: await board.people(actor) };
}

export interface ApplyResult {
  created: number;
  updated: number;
  /** Came in as Next because the Company's Now was full. */
  notInNow: number;
  projects: { created: number; updated: number; updates: number };
  failed: { id: string; reason: string }[];
}

/**
 * Makes the board changes in a plan through the same operations as the screen, so every rule
 * applies and every change is on the Trail ("sync"). One Task or Project failing never stops the rest.
 */
export async function applyBoardChanges(board: Board, actor: Actor, plan: SyncPlan, side: BoardSide, config: SyncConfig): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, updated: 0, notInNow: 0, projects: { created: 0, updated: 0, updates: 0 }, failed: [] };
  const areaId = async (companyId: string, departmentId: string, name: string | null): Promise<string | null> => {
    if (!name) return null;
    const found = side.areas.find((a) => a.companyId === companyId && a.departmentId === departmentId && a.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const area = await board.createArea(actor, { companyId, departmentId, name });
    side.areas.push(area);
    return area.id;
  };
  const people = new People(side.people);
  // Who wrote a team board log line, by name, so the Update shows it even if they aren't on the board.
  const writer = (by: string | undefined, byName: string | undefined) =>
    byName?.trim() || (by && people.get(config.people[by]?.toLowerCase() ?? "")?.name) || "Team board";
  const addUpdates = async (projectId: string, lines: { at: string; by?: string; byName?: string; text: string }[]) => {
    for (const line of lines) {
      await board.addProjectUpdate(actor, projectId, { text: line.text.slice(0, 500), at: new Date(line.at).toISOString(), byName: writer(line.by, line.byName) });
      result.projects.updates++;
    }
  };

  // Projects first, so Tasks can be put in a Project made in this run.
  const projectIds = new Map(side.links.projects);
  for (const op of plan.projects) {
    try {
      const s = op.shape;
      const fields = {
        name: s.name,
        goal: s.goal,
        ownerId: s.ownerId,
        ownerName: s.ownerName,
        phase: s.phase,
        repository: s.repository,
        portalApp: s.portalApp,
        liveUrl: s.liveUrl,
        order: s.order,
      };
      if (op.kind === "create") {
        const project = await board.createProject(actor, {
          companyId: s.companyId,
          departmentId: s.departmentId,
          areaId: await areaId(s.companyId, s.departmentId, s.areaName),
          ...fields,
          source: teamBoardSource(op.groupId),
        });
        projectIds.set(op.groupId, project.id);
        await addUpdates(project.id, op.updates);
        result.projects.created++;
        continue;
      }
      const changed = new Set(op.fields);
      if (changed.has("removed") && !s.removed) await board.restoreProject(actor, op.projectId);
      if (changed.has("home")) {
        await board.moveProject(actor, op.projectId, { departmentId: s.departmentId, areaId: await areaId(s.companyId, s.departmentId, s.areaName) });
      }
      const others = [...changed].filter((f) => f !== "home" && f !== "removed");
      if (others.length) await board.updateProject(actor, op.projectId, fields);
      if (changed.has("removed") && s.removed) await board.removeProject(actor, op.projectId);
      await addUpdates(op.projectId, op.updates);
      if (op.fields.length) result.projects.updated++;
    } catch (error) {
      if (!(error instanceof BoardError)) throw error;
      result.failed.push({ id: op.groupId, reason: error.message });
    }
  }
  const projectFor = (groupId: string | null) =>
    groupId ? (projectIds.get(groupId) ?? (groupId.startsWith("vb-") ? groupId.slice(3) : null)) : null;

  for (const op of plan.board) {
    try {
      const s = op.shape;
      if (op.kind === "create") {
        const projectId = projectFor(s.groupId);
        const home = { companyId: s.companyId, departmentId: s.departmentId, areaId: await areaId(s.companyId, s.departmentId, s.areaName) };
        const create = (status: Task["status"]) =>
          board.createTask(actor, {
            ...home,
            title: s.title,
            priority: s.priority,
            status,
            ownerIds: s.ownerIds,
            ownerNames: s.ownerNames,
            companyOwner: s.companyOwner,
            projectId,
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
        ...(fields.has("ownerIds") || fields.has("ownerNames") ? { ownerIds: s.ownerIds, ownerNames: s.ownerNames } : {}),
        ...(fields.has("companyOwner") ? { companyOwner: s.companyOwner } : {}),
        ...(fields.has("project") ? { projectId: projectFor(s.groupId) } : {}),
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
