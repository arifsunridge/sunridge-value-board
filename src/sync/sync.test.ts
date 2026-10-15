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
    snap.actions[w.doc_id] = (w.op === "set" ? w.data : { ...snap.actions[w.doc_id], ...w.data }) as unknown as TeamBoardSnapshot["actions"][string];
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
    const result = await applyBoardChanges(board, arif, plan, side);
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

    // No Owner on the team board: the syncing Member owns it. The title is cut to 8 words.
    const budget = view.tasks.find((t) => t.title.startsWith("Draft an example budget"))!;
    expect(budget.ownerIds).toEqual(["m-arif"]);
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

  it("keeps board Owners the team board can't name", async () => {
    const snap = snapshot();
    await run(snap);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    clock = new Date("2026-10-14T12:00:00Z");
    await board.updateTask(arif, speeds.id, { ownerIds: ["m-theran", "m-jack"] });
    clock = new Date("2026-10-14T13:00:00Z");
    // Jack isn't on the team board, so the board's extra Owner is not a difference.
    expect((await run(snap)).plan.artifact).toEqual([]);
    snap.actions.a1 = { ...snap.actions.a1!, ownerIds: ["u_arif"], editedAt: "2026-10-14T13:30:00Z" };
    clock = new Date("2026-10-14T14:00:00Z");
    await run(snap);
    expect((await board.task(arif, speeds.id)).task.ownerIds).toEqual(["m-arif", "m-jack"]);
  });

  it("stands in as Owner until the team board's Owner signs in, then hands over", async () => {
    const snap = snapshot();
    snap.config = { ...config, people: { ...config.people, u_new: "new.person@example.com" } };
    snap.actions.a1 = { ...snap.actions.a1!, ownerIds: ["u_new"] };
    await run(snap);
    const speeds = (await board.board(arif, "c-hbf")).tasks.find((t) => t.title === "Check sample line speeds")!;
    expect(speeds.ownerIds).toEqual(["m-arif"]);
    clock = new Date("2026-10-14T12:00:00Z");
    expect((await run(snap)).plan.artifact.filter((w) => w.doc_id === "a1")).toEqual([]);

    await board.recordPerson({ id: "new.person@example.com", email: "new.person@example.com", name: "New Example", kind: "member", companyId: null });
    clock = new Date("2026-10-14T13:00:00Z");
    const { plan } = await run(snap);
    expect(plan.artifact.filter((w) => w.doc_id === "a1")).toEqual([]);
    expect((await board.task(arif, speeds.id)).task.ownerIds).toEqual(["new.person@example.com"]);
    expect(snap.actions.a1!.ownerIds).toEqual(["u_new"]);
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
