import { beforeEach, describe, expect, it } from "vitest";
import { Board, type Actor } from "./board";
import { BoardError } from "./rules";
import { MemoryStore } from "@/store/memory";
import { demoSeed } from "@/store/seed";

// Projects group Tasks in one Home (ADR 0008). Invented data only.
const arif: Actor = { memberId: "m-arif", via: "screen" };
const theran: Actor = { memberId: "m-theran", via: "screen" };
const jordan: Actor = { memberId: "h-jordan", via: "screen" };

let board: Board;
let seq = 0;

beforeEach(() => {
  seq = 0;
  board = new Board(new MemoryStore(demoSeed()), () => new Date("2026-10-04T10:00:00Z"), () => `id-${++seq}`);
});

async function expectError(promise: Promise<unknown>, code: BoardError["code"]) {
  await expect(promise).rejects.toMatchObject({ name: "BoardError", code });
}

const newProject = (over = {}) =>
  board.createProject(arif, { companyId: "c-hbf", departmentId: "operations", areaId: "a-hbf-manufacturing", name: "Example line rebuild", ...over });

describe("Projects (ADR 0008)", () => {
  it("lives in one Home, with a goal, an Owner and a Phase, all on the Trail", async () => {
    const project = await newProject({ goal: "Faster changeovers.", ownerName: "Example Colleague", phase: "building", repository: "example-org/example-app" });
    expect(project).toMatchObject({ departmentId: "operations", areaId: "a-hbf-manufacturing", ownerId: null, ownerName: "Example Colleague", phase: "building" });
    const changed = await board.updateProject(arif, project.id, { ownerName: "Theran Example", phase: "live" });
    // A typed name that is someone on the board becomes that person.
    expect(changed).toMatchObject({ ownerId: "m-theran", ownerName: "", phase: "live" });
    const { trail } = await board.project(arif, project.id);
    expect(trail.map((e) => e.action)).toEqual(["created", "changed", "changed", "changed"]);
  });

  it("refuses a bad Phase, Portal app or live address", async () => {
    await expectError(newProject({ phase: "done" }), "invalid");
    await expectError(newProject({ portalApp: "Site Flow!" }), "invalid");
    await expectError(newProject({ liveUrl: "http://example.com" }), "invalid");
  });

  it("puts a Task where its Project lives, and counts Progress over its Tasks", async () => {
    const project = await newProject();
    const task = await board.createTask(arif, { companyId: "c-hbf", departmentId: "finance", title: "Draft the rebuild plan", priority: "medium", projectId: project.id });
    expect(task).toMatchObject({ departmentId: "operations", areaId: "a-hbf-manufacturing", projectId: project.id });
    await board.updateTask(theran, "t-2", { projectId: project.id });
    await board.moveTask(arif, task.id, { status: "done" });
    expect((await board.projects(arif, "c-hbf"))[0]!.progress).toEqual({ done: 1, total: 2 });
  });

  it("takes a Task out of its Project when the Task moves away", async () => {
    const project = await newProject();
    const task = await board.createTask(arif, { companyId: "c-hbf", departmentId: "operations", title: "Draft the rebuild plan", priority: "medium", projectId: project.id });
    const moved = await board.moveTask(arif, task.id, { status: "next", departmentId: "strategy", areaId: null });
    expect(moved.projectId).toBeNull();
  });

  it("moves its Tasks when it moves, and won't take a Shared Task into Finance", async () => {
    const project = await newProject();
    await board.updateTask(theran, "t-2", { projectId: project.id });
    await expectError(board.moveProject(arif, project.id, { departmentId: "finance" }), "invalid");
    await board.moveProject(arif, project.id, { departmentId: "innovation", areaId: "a-hbf-systems" });
    expect((await board.task(arif, "t-2")).task).toMatchObject({ departmentId: "innovation", areaId: "a-hbf-systems", projectId: project.id });
  });

  it("keeps Updates as news that can't be changed", async () => {
    const project = await newProject();
    await board.addProjectUpdate(arif, project.id, { text: "Kicked off." });
    // Only the sync may bring an Update with its own time and author.
    await board.addProjectUpdate(arif, project.id, { text: "Back-dated?", at: "2020-01-01T00:00:00Z", byName: "Someone" });
    const { updates } = await board.project(arif, project.id);
    expect(updates.map((u) => [u.text, u.byName, u.at])).toEqual([
      ["Kicked off.", "Arif Bayrak", "2026-10-04T10:00:00.000Z"],
      ["Back-dated?", "Arif Bayrak", "2026-10-04T10:00:00.000Z"],
    ]);
    await expectError(board.addProjectUpdate(arif, project.id, { text: "  " }), "invalid");
  });

  it("shows the HBF team a Project only through its Shared Tasks, without its details", async () => {
    const project = await newProject({ goal: "Internal goal.", repository: "example-org/example-app" });
    expect(await board.projects(jordan, "c-hbf")).toEqual([]);
    await expectError(board.project(jordan, project.id), "not_found");
    await board.updateTask(theran, "t-2", { projectId: project.id });
    const [seen] = await board.projects(jordan, "c-hbf");
    expect(seen!.project).toMatchObject({ name: "Example line rebuild", goal: "", repository: "" });
    expect((await board.project(jordan, project.id)).updates).toEqual([]);
    await expectError(board.createProject(jordan, { companyId: "c-hbf", departmentId: "operations", name: "Not allowed" }), "not_allowed");
  });

  it("moves an Area's Projects with its Tasks when the Area is retired", async () => {
    const project = await newProject();
    await board.updateTask(theran, "t-2", { projectId: project.id });
    await board.retireArea(arif, "a-hbf-manufacturing", { areaId: "a-hbf-warehouse" });
    expect((await board.project(arif, project.id)).project.areaId).toBe("a-hbf-warehouse");
    expect((await board.task(arif, "t-2")).task).toMatchObject({ areaId: "a-hbf-warehouse", projectId: project.id });
  });

  it("finishes a Task with its evidence first", async () => {
    const { task, document } = await board.finishTask(arif, "t-6", { kind: "link", name: "Pipeline report", url: "https://example.com/report", status: "final" });
    expect(task.status).toBe("done");
    expect(document).toMatchObject({ taskId: "t-6", name: "Pipeline report" });
  });
});
