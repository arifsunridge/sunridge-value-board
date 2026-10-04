"use server";

import { revalidatePath } from "next/cache";
import type { Actor, Board, Move, NewTask, TaskChanges } from "@/board/board";
import type { DocumentKind, DocumentStatus } from "@/board/model";
import { BoardError } from "@/board/rules";
import { board } from "@/server/context";
import { requireMember } from "@/server/session";

export type ActionResult = { ok: true; id?: string } | { ok: false; message: string };

async function run(fn: (b: Board, actor: Actor) => Promise<{ id: string } | unknown>): Promise<ActionResult> {
  const member = await requireMember();
  try {
    const result = await fn(board(), { memberId: member.id, via: "screen" });
    revalidatePath("/", "layout");
    const id = result && typeof result === "object" && "id" in result ? String(result.id) : undefined;
    return { ok: true, id };
  } catch (error) {
    if (error instanceof BoardError) return { ok: false, message: error.message };
    // Never log Task content (ADR 0002): the error's name and status only.
    console.error("Board action failed:", error instanceof Error ? error.name : "unknown", (error as { status?: number }).status ?? "");
    return { ok: false, message: "That didn't save. Try again in a moment." };
  }
}

export async function createTask(input: NewTask) {
  return run((b, a) => b.createTask(a, input));
}
export async function updateTask(id: string, changes: TaskChanges) {
  return run((b, a) => b.updateTask(a, id, changes));
}
export async function moveTask(id: string, move: Move) {
  return run((b, a) => b.moveTask(a, id, move));
}
export async function changeCompany(id: string, to: { companyId: string; departmentId: string; areaId?: string | null }) {
  return run((b, a) => b.changeCompany(a, id, to));
}
export async function joinTask(id: string) {
  return run((b, a) => b.joinTask(a, id));
}
export async function removeTask(id: string) {
  return run((b, a) => b.removeTask(a, id));
}
export async function restoreTask(id: string) {
  return run((b, a) => b.restoreTask(a, id));
}

export async function addLink(taskId: string, input: { kind: Exclude<DocumentKind, "file">; name: string; url: string; status: DocumentStatus }) {
  return run((b, a) => b.addDocument(a, taskId, input));
}
export async function updateDocument(id: string, changes: { name?: string; status?: DocumentStatus }) {
  return run((b, a) => b.updateDocument(a, id, changes));
}
export async function replaceLink(id: string, url: string) {
  return run((b, a) => b.replaceDocument(a, id, { url }));
}
export async function moveDocument(id: string, toTaskId: string) {
  return run((b, a) => b.moveDocument(a, id, toTaskId));
}
export async function removeDocument(id: string) {
  return run((b, a) => b.removeDocument(a, id));
}
export async function restoreDocument(id: string) {
  return run((b, a) => b.restoreDocument(a, id));
}

export async function createArea(input: { companyId: string; departmentId: string; name: string }) {
  return run((b, a) => b.createArea(a, input));
}
export async function renameArea(id: string, name: string) {
  return run((b, a) => b.renameArea(a, id, name));
}
export async function retireArea(id: string, moveToAreaId: string | null) {
  return run((b, a) => b.retireArea(a, id, { areaId: moveToAreaId }));
}
