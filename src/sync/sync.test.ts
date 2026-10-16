import { beforeEach, describe, expect, it } from "vitest";
import { Board, type Actor } from "@/board/board";
import { MemoryStore } from "@/store/memory";
import { demoSeed } from "@/store/seed";
import { applyBoardChanges, readBoardSide } from "./apply";
import { handleSync } from "./endpoint";
import { artifactIdFor, planSync, type ArtifactWrite, type TeamBoardSnapshot } from "./plan";

// Invented data only.
const config = {
  people: { u_arif: "m-arif", u_theran: "m-theran" },
  projects: { "p-acme": "HBF", "p-internal": "Sunridge" },
  newTaskProject: { HBF: "p-acme", Sunridge: "p-internal" },
  syncAs: "u_arif",
};

function snapshot(): TeamBoardSnapshot {
  return {
    config,
    categories: {
      "d-operations": { name: "Operations", parentId: null, projectId: null },
      "s-plant": { name: "Manufacturing", parentId: "d-operations", projectId: "p-acme" },
      "s-yard": { name: "Example yard", parentId: "d-operations", projectId: "p-acme" },
    },
    actions: {
      a1: {
        title: "Check sample line speeds",
        status: "now",
        priority: "high",
        categoryId: "s-plant",
        projectId: "p-acme",
        due: "2026-10-20",
        ownerIds: ["u_theran"],
        editedAt: "2026-10-01T09:00:00Z",
      },
      a2: {
        title: "Draft an example budget for the new pilot line next quarter",
        status: "next",
        priority: "medium",
        categoryId: "s-yard",
        projectId: "p-acme",
        ownerIds: [],
        editedAt: "2026-10-01T09:00:00Z",
      },
      a3: { title: "Removed before any sync", status: "next", projectId: "p-acme", removed: true, editedAt: "2026-10-01T09:00:00Z" },
    },
    documents: { d1: { taskId: "a1", kind: "claude", status: "review", title: "Line speed analysis", url: "https://claude.ai/artifact/example" } },
  };
}

/** What the routine does with the answer: write each document into the artifact. */
function applyWrites(snap: TeamBoardSnapshot, writes: ArtifactWrite[]): void {
  for (const w of writes) {
    const docs = (w.collection === "groups" ? (snap.groups ??= {}) : snap.actions) as Record<string, unknown>;
    docs[w.doc_id] = w.op === "set" ? w.data : { ...(docs[w.doc_id] as object), ...w.data };
  }
}

describe("the team board sync", () => {
  const arif: Actor = { memberId: "m-arif", via: "sync" };
  let clock: Date;
  let board: Board;
  beforeEach(() => {
    clock = new Date("2026-10-14T10:00:00Z");
    board = new Board(new MemoryStore(demoSeed()), () => clock);
  });

  async function run(snap: TeamBoardSnapshot) {
    const side = await readBoardSide(board, arif);
    const plan = planSync(snap, side, clock.toISOString());
    const result = await applyBoardChanges(board, arif, plan, side, snap.config);
    applyWrites(snap, plan.artifact);
    return { plan, result };
  }

  it("adds team board Tasks to the board, and board Tasks to the team board", async () => {
    const snap = snapshot();
    const { plan, result } = await run(snap);
    expect(result).toMatchObject({ created: 2, failed: [] });

    const view = await board.board(arif, "c-hbf");
    const speeds = view.tasks.find((t) => t.title === "Check sample line speeds")!;
    expect(speeds).toMatchObject({ status: "now", priority: "high", ownerIds: ["m-theran"], due: "2026-10-20" });
    expect(view.areas.find((a) => a.id === speeds.areaId)?.name).toBe("Manufacturing");
    const detail = await board.task(arif, speeds.id);
    expect(detail.documents.map((d) => d.name)).toEqual(["Line speed analysis"]);
    expect(detail.trail[0]).toMatchObject({ action: "created", via: "sync", old: "Team board (a1)" });

    // No Owner on the team board: none on the board either (ADR 0009). The title is cut to 8 words.
    const budget = view.tasks.find((t) => t.title.startsWith("Draft an example budget"))!;
    expect(budget).toMatchObject({ ownerIds: [], ownerNames: [] });
    expect(budget.title.split(" ")).toHaveLength(8);
    expect(view.areas.some((a) => a.name === "Example yard")).toBe(true);

    // The seed's own Tasks go to the team board, under ids that link them back.
    const seedTask = (await board.board(arif, "c-hbf")).tasks.find((t) => t.id === "t-1")!;
    const write = plan.artifact.find((w) => w.doc_id === artifactIdFor("t-1"))!;
    expect(write).toMatchObject({ op: "set", data: { title: seedTask.title, projectId: "p-acme", categoryId: "s-plant", ownerIds: ["u_theran"] } });
    expect(plan.artifact.some((w) => w.doc_id === "a3")).toBe(false);
  });

  it("changes nothing the second time", async () => {
    const snap = snapshot();
    await run(snap);
    clock = new Date("2026-10-14T11:00:00Z");
    const { plan } = await run(snap);
    expect(plan.board).toEqual([]);
    expect(plan.artifact).toEqual([]);
  });

  it("copies a newer change on the team board to the board", async () => {
    const snap = snapshot();
    await run(snap);
    clock = new Date("2026-10-14T12:00:00Z");
    snap.actions.a1 = { ...snap.actions.a1!, status: "blocked", waitingOn: "Example supplier quote", editedAt: "2026-10-14T11:30:00Z" };
    const { plan, result } = await run(snap);
    expect(plan.board).toHaveLength(1);
    expect(result.failed).toEqual([]);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    expect(speeds).toMatchObject({ status: "blocked", note: "Example supplier quote" });
  });

  it("copies a newer change on the board to the team board", async () => {
    const snap = snapshot();
    await run(snap);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    clock = new Date("2026-10-14T12:00:00Z");
    await board.updateTask({ memberId: "m-theran", via: "screen" }, speeds.id, { priority: "low", due: "2026-11-02" });
    clock = new Date("2026-10-14T13:00:00Z");
    const { plan } = await run(snap);
    expect(plan.board).toEqual([]);
    expect(plan.artifact).toEqual([
      expect.objectContaining({ op: "update", doc_id: "a1", data: expect.objectContaining({ priority: "low", due: "2026-11-02", editedBy: "u_arif" }) }),
    ]);
    expect(snap.actions.a1).toMatchObject({ priority: "low", title: "Check sample line speeds" });
  });

  it("sends Owners the team board has no user for by name, and settles", async () => {
    const snap = snapshot();
    await run(snap);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    clock = new Date("2026-10-14T12:00:00Z");
    await board.updateTask(arif, speeds.id, { ownerIds: ["m-theran", "m-jack"] });
    clock = new Date("2026-10-14T13:00:00Z");
    // Jack has no team board user, so he goes there by name.
    const { plan } = await run(snap);
    expect(plan.artifact).toEqual([expect.objectContaining({ doc_id: "a1", data: expect.objectContaining({ ownerIds: ["u_theran"], ownerNames: ["Jack Example"] }) })]);
    clock = new Date("2026-10-14T14:00:00Z");
    expect((await run(snap)).plan).toMatchObject({ board: [], artifact: [] });
    // Someone renames the Owners on the team board: the board follows, and Jack is still Jack.
    snap.actions.a1 = { ...snap.actions.a1!, ownerIds: ["u_arif"], editedAt: "2026-10-14T14:30:00Z" };
    clock = new Date("2026-10-14T15:00:00Z");
    await run(snap);
    expect((await board.task(arif, speeds.id)).task).toMatchObject({ ownerIds: ["m-arif", "m-jack"], ownerNames: [] });
  });

  it("never stands in as Owner: an Owner the board can't place stays on the team board only (ADR 0009)", async () => {
    const snap = snapshot();
    snap.config = { ...config, people: { ...config.people, u_new: "new.person@example.com" } };
    snap.actions.a1 = { ...snap.actions.a1!, ownerIds: ["u_new"], ownerNames: ["Example Colleague"], hbfOwner: "Example Manager" };
    await run(snap);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    expect(speeds).toMatchObject({ ownerIds: [], ownerNames: ["Example Colleague"], companyOwner: "Example Manager" });
    clock = new Date("2026-10-14T12:00:00Z");
    expect((await run(snap)).plan.artifact.filter((w) => w.doc_id === "a1")).toEqual([]);

    // Once the Portal lists them, they are the Owner on the board too, and the team board keeps its user.
    await board.recordDirectory([{ id: "new.person@example.com", email: "new.person@example.com", name: "New Example", kind: "member", companyId: null, signedInAt: null }]);
    snap.actions.a1 = { ...snap.actions.a1!, editedAt: "2026-10-14T12:30:00Z" };
    clock = new Date("2026-10-14T13:00:00Z");
    await run(snap);
    expect((await board.task(arif, speeds.id)).task.ownerIds).toEqual(["new.person@example.com"]);
    expect(snap.actions.a1!.ownerIds).toEqual(["u_new"]);
  });

  it("releases a stand-in Owner the earlier sync put on a Task, and never sends it to the team board", async () => {
    const snap = snapshot();
    await run(snap);
    const budget = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title.startsWith("Draft an example budget"))!;
    // What the sync did before ADR 0009: the syncing Member stood in as Owner.
    clock = new Date("2026-10-14T11:00:00Z");
    await board.updateTask(arif, budget.id, { ownerIds: ["m-arif"] });
    clock = new Date("2026-10-14T12:00:00Z");
    const { plan } = await run(snap);
    expect(plan.artifact.filter((w) => w.doc_id === "a2")).toEqual([]);
    expect((await board.task(arif, budget.id)).task.ownerIds).toEqual([]);
    clock = new Date("2026-10-14T13:00:00Z");
    expect((await run(snap)).plan).toMatchObject({ board: [], artifact: [] });
  });

  it("keeps an Owner a person chose on the board, even if it is the syncing Member", async () => {
    const snap = snapshot();
    await run(snap);
    const budget = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title.startsWith("Draft an example budget"))!;
    clock = new Date("2026-10-14T11:00:00Z");
    await board.updateTask({ memberId: "m-arif", via: "screen" }, budget.id, { ownerIds: ["m-arif"] });
    clock = new Date("2026-10-14T12:00:00Z");
    const { plan } = await run(snap);
    expect(plan.artifact).toEqual([expect.objectContaining({ doc_id: "a2", data: expect.objectContaining({ ownerIds: ["u_arif"] }) })]);
    expect((await board.task(arif, budget.id)).task.ownerIds).toEqual(["m-arif"]);
  });

  it("fills a Project, HBF owner and typed Owners the board never had, even when the board changed last", async () => {
    // As in production on 16 Oct: Tasks synced before this release, then edited on the board, then the team board gains groups.
    const snap = snapshot();
    await run(snap);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    clock = new Date("2026-10-14T11:00:00Z");
    await board.updateTask({ memberId: "m-theran", via: "screen" }, speeds.id, { due: "2026-11-02" });
    snap.groups = { g1: { name: "Example line project", projectId: "p-acme", categoryId: "s-plant", editedAt: "2026-10-02T09:00:00Z" } };
    snap.actions.a1 = { ...snap.actions.a1!, groupId: "g1", hbfOwner: "Example Manager", ownerNames: ["Example Colleague"] };
    clock = new Date("2026-10-14T12:00:00Z");
    const { plan } = await run(snap);
    // The board's newer due date goes to the team board, which keeps its group, HBF owner and names.
    const write = plan.artifact.find((w) => w.doc_id === "a1")!;
    expect(write.data).toMatchObject({ due: "2026-11-02", groupId: "g1", hbfOwner: "Example Manager", ownerNames: ["Example Colleague"] });
    expect(snap.actions.a1).toMatchObject({ groupId: "g1", hbfOwner: "Example Manager" });
    const task = (await board.task(arif, speeds.id)).task;
    const project = (await board.board(arif, "c-hbf")).projects.find((p) => p.project.name === "Example line project")!;
    expect(task).toMatchObject({ projectId: project.project.id, companyOwner: "Example Manager", ownerNames: ["Example Colleague"], ownerIds: ["m-theran"] });
    clock = new Date("2026-10-14T13:00:00Z");
    expect((await run(snap)).plan).toMatchObject({ board: [], artifact: [] });

    // Once set on the board, clearing it there is a real change and goes to the team board.
    clock = new Date("2026-10-14T14:00:00Z");
    await board.updateTask({ memberId: "m-theran", via: "screen" }, speeds.id, { companyOwner: "" });
    clock = new Date("2026-10-14T15:00:00Z");
    await run(snap);
    expect(snap.actions.a1).toMatchObject({ hbfOwner: "" });
  });

  it("leaves Projects alone when the routine sends no groups", async () => {
    const snap = snapshot();
    snap.groups = { g1: { name: "Example line project", projectId: "p-acme", categoryId: "s-plant", editedAt: "2026-10-02T09:00:00Z" } };
    snap.actions.a1 = { ...snap.actions.a1!, groupId: "g1" };
    await run(snap);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    expect(speeds.projectId).not.toBeNull();
    // An older routine: no groups in the snapshot, and a newer change on the team board.
    const older: TeamBoardSnapshot = { ...snap, groups: undefined, actions: { ...snap.actions, a1: { ...snap.actions.a1!, priority: "low", editedAt: "2026-10-14T11:30:00Z" } } };
    clock = new Date("2026-10-14T12:00:00Z");
    const { plan } = await run(older);
    expect(plan.artifact.filter((w) => w.collection === "groups")).toEqual([]);
    expect((await board.task(arif, speeds.id)).task).toMatchObject({ priority: "low", projectId: speeds.projectId });
    // And a board change sent back keeps the team board's group.
    clock = new Date("2026-10-14T13:00:00Z");
    await board.updateTask({ memberId: "m-theran", via: "screen" }, speeds.id, { due: "2026-11-09" });
    clock = new Date("2026-10-14T14:00:00Z");
    const back = await run(older);
    expect(back.plan.artifact.find((w) => w.doc_id === "a1")!.data).toMatchObject({ due: "2026-11-09", groupId: "g1" });
  });

  it("treats a live address with and without its closing slash as the same", async () => {
    const snap = snapshot();
    snap.groups = { g1: { name: "Example app", projectId: "p-acme", categoryId: "s-plant", liveUrl: "https://example-app.example.com", editedAt: "2026-10-20T09:00:00Z" } };
    await run(snap);
    const again = await run(snap);
    expect(again.plan.projects).toEqual([]);
    expect(again.plan.artifact).toEqual([]);
  });

  it("brings team board Projects to the board, puts their Tasks in them, and merges Updates both ways (ADR 0008)", async () => {
    const snap = snapshot();
    snap.groups = {
      g1: {
        name: "Example line project",
        note: "Faster changeovers on the example line.",
        projectId: "p-acme",
        categoryId: "s-plant",
        ownerName: "Example Colleague",
        phase: "building",
        log: [{ at: "2026-10-02T09:00:00Z", by: "u_theran", text: "Kicked off." }],
        editedAt: "2026-10-02T09:00:00Z",
      },
    };
    snap.actions.a1 = { ...snap.actions.a1!, groupId: "g1" };
    const { result } = await run(snap);
    expect(result.projects).toEqual({ created: 1, updated: 0, updates: 1 });
    const view = await board.board(arif, "c-hbf");
    const project = view.projects.find((p) => p.project.name === "Example line project")!;
    expect(project.project).toMatchObject({ ownerName: "Example Colleague", phase: "building", goal: "Faster changeovers on the example line." });
    expect(view.tasks.find((t) => t.title === "Check sample line speeds")!.projectId).toBe(project.project.id);
    const detail = await board.project(arif, project.project.id);
    expect(detail.updates).toEqual([expect.objectContaining({ byName: "Theran Example", text: "Kicked off.", at: "2026-10-02T09:00:00.000Z" })]);

    // An Update written on the board goes to the team board's log; nothing repeats after that.
    clock = new Date("2026-10-14T12:00:00Z");
    await board.addProjectUpdate({ memberId: "m-arif", via: "screen" }, project.project.id, { text: "Pilot shift booked." });
    clock = new Date("2026-10-14T13:00:00Z");
    const second = await run(snap);
    expect(second.plan.artifact).toEqual([expect.objectContaining({ collection: "groups", doc_id: "g1" })]);
    expect(snap.groups.g1!.log!.map((e) => e.text)).toEqual(["Kicked off.", "Pilot shift booked."]);
    clock = new Date("2026-10-14T14:00:00Z");
    expect((await run(snap)).plan).toMatchObject({ projects: [], board: [], artifact: [] });

    // A board Project goes to the team board, and stays linked.
    await board.createProject(arif, { companyId: "c-hbf", departmentId: "innovation", areaId: "a-hbf-systems", name: "Example board project", phase: "idea" });
    clock = new Date("2026-10-14T15:00:00Z");
    const third = await run(snap);
    expect(third.plan.artifact).toEqual([expect.objectContaining({ op: "set", collection: "groups", data: expect.objectContaining({ name: "Example board project", phase: "idea" }) })]);
    clock = new Date("2026-10-14T16:00:00Z");
    expect((await run(snap)).plan).toMatchObject({ projects: [], board: [], artifact: [] });
  });

  it("removes a Task on the board when it is removed on the team board", async () => {
    const snap = snapshot();
    await run(snap);
    clock = new Date("2026-10-14T12:00:00Z");
    snap.actions.a1 = { ...snap.actions.a1!, removed: true, editedAt: "2026-10-14T11:30:00Z" };
    await run(snap);
    expect((await board.board(arif, "c-hbf")).tasks.some((t) => t.title === "Check sample line speeds")).toBe(false);
  });
});

describe("the sync endpoint", () => {
  const token = "x".repeat(40);
  const options = (overrides = {}) => ({
    board: new Board(new MemoryStore(demoSeed()), () => new Date("2026-10-14T10:00:00Z")),
    token,
    asEmail: "m-arif",
    now: () => new Date("2026-10-14T10:00:00Z"),
    ...overrides,
  });
  const post = (body: unknown, auth = `Bearer ${token}`) =>
    new Request("https://board.example.com/api/sync", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("is off without a token", async () => {
    expect((await handleSync(post(snapshot()), options({ token: undefined }))).status).toBe(404);
  });

  it("refuses a wrong token", async () => {
    expect((await handleSync(post(snapshot(), "Bearer wrong"), options())).status).toBe(401);
  });

  it("refuses a snapshot that syncs as someone else", async () => {
    const snap = { ...snapshot(), config: { ...config, syncAs: "u_theran" } };
    expect((await handleSync(post(snap), options())).status).toBe(403);
  });

  it("answers with the writes for the team board", async () => {
    const response = await handleSync(post(snapshot()), options());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.board).toMatchObject({ created: 2 });
    expect(body.artifactWrites.length).toBeGreaterThan(0);
  });
});
