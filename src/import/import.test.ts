import { beforeEach, describe, expect, it } from "vitest";
import { Board, type Actor } from "@/board/board";
import { MemoryStore } from "@/store/memory";
import { demoSeed } from "@/store/seed";
import { applyReview } from "./apply";
import { prepareTeamBoard, shortNote, type TeamBoardExport } from "./team-board";

// Invented data only.
const exported: TeamBoardExport = {
  projects: { "p-acme": { name: "HBF" }, "p-internal": { name: "Sunridge" } },
  categories: {
    "d-operations": { name: "Operations", parentId: null, projectId: null },
    "d-finance": { name: "Finance", parentId: null, projectId: null },
    "s-plant": { name: "Manufacturing", parentId: "d-operations", projectId: "p-acme" },
  },
  actions: {
    a1: { title: "Check sample line speeds", status: "now", priority: "high", categoryId: "s-plant", projectId: "p-acme", due: "2026-10-20", ownerIds: ["u_one"], note: "" },
    a2: {
      title: "Draft an example budget for the new pilot line next quarter",
      status: "blocked",
      priority: "medium",
      categoryId: "d-finance",
      projectId: "p-acme",
      due: "",
      ownerIds: ["u_two"],
      waitingOn: "Example supplier quote",
    },
    a3: { title: "Write up example findings", status: "done", priority: "low", categoryId: null, projectId: "p-internal", ownerIds: ["u_unknown"], note: "one\ntwo\nthree" },
    a4: { title: "Removed one", status: "next", projectId: "p-acme", ownerIds: ["u_one"], removed: true },
  },
  documents: {
    d1: { taskId: "a1", kind: "claude", status: "review", title: "Line speed analysis", url: "https://claude.ai/artifact/example" },
    d2: { taskId: "a1", kind: "claude", status: "final", title: "Not https", url: "http://example.com" },
  },
};
const options = {
  people: { u_one: "m-theran", u_two: "m-jack" },
  guessed: ["u_two"],
  companies: { "p-acme": "HBF", "p-internal": "Sunridge" },
};

describe("preparing the team board for import", () => {
  it("maps Homes, people, Priority, Status and Documents, and leaves removed Tasks out", () => {
    const items = prepareTeamBoard(exported, options);
    expect(items.map((i) => i.prototypeId).sort()).toEqual(["a1", "a2", "a3"]);
    expect(items.find((i) => i.prototypeId === "a1")).toMatchObject({
      company: "HBF",
      departmentId: "operations",
      area: "Manufacturing",
      priority: "high",
      status: "now",
      ownerIds: ["m-theran"],
      due: "2026-10-20",
      documents: [{ kind: "claude", name: "Line speed analysis", status: "in_review" }],
      check: [],
      approved: true,
    });
  });

  it("flags what a Member should check, and leaves those unticked", () => {
    const items = prepareTeamBoard(exported, options);
    const a2 = items.find((i) => i.prototypeId === "a2")!;
    expect(a2).toMatchObject({ status: "blocked", note: "Example supplier quote", approved: false });
    expect(a2.title.split(" ")).toHaveLength(8);
    expect(a2.check).toEqual(expect.arrayContaining([expect.stringContaining("cut to 8 words"), expect.stringContaining("best guess")]));
    const a3 = items.find((i) => i.prototypeId === "a3")!;
    expect(a3.check).toEqual(
      expect.arrayContaining([expect.stringContaining("No Department"), expect.stringContaining("Unknown person"), expect.stringContaining("Note shortened")]),
    );
  });

  it("keeps notes within two lines and 200 characters, cutting at a word", () => {
    const long = shortNote("word ".repeat(80));
    expect(long.cut).toBe(true);
    expect(long.note.length).toBeLessThanOrEqual(200);
    expect(long.note.endsWith("…")).toBe(true);
    expect(shortNote("short note")).toEqual({ note: "short note", cut: false });
  });
});

describe("applying a reviewed import", () => {
  const arif: Actor = { memberId: "m-arif", via: "import" };
  let board: Board;
  beforeEach(() => {
    board = new Board(new MemoryStore(demoSeed()), () => new Date("2026-10-14T10:00:00Z"));
  });
  const companies = { "p-acme": "HBF", "p-internal": "Sunridge" };
  const people = { u_one: "m-theran", u_two: "m-jack", u_unknown: "m-arif" };

  it("adds approved Tasks with their Area, Documents and Status, on the Trail as an import", async () => {
    const items = prepareTeamBoard(exported, { people, companies }).map((i) => ({ ...i, approved: true }));
    const result = await applyReview(board, arif, items);
    expect(result.skipped).toEqual([]);
    expect(result.imported).toHaveLength(3);
    const view = await board.board(arif, "c-hbf");
    const speeds = view.tasks.find((t) => t.title === "Check sample line speeds")!;
    expect(speeds).toMatchObject({ status: "now", priority: "high", ownerIds: ["m-theran"], shared: false });
    expect(view.areas.find((a) => a.id === speeds.areaId)?.name).toBe("Manufacturing");
    const detail = await board.task(arif, speeds.id);
    expect(detail.documents.map((d) => d.name)).toEqual(["Line speed analysis"]);
    expect(detail.trail[0]).toMatchObject({ action: "created", via: "import", old: "Team board import (a1)" });
    expect(view.tasks.find((t) => t.title.startsWith("Draft an example budget"))).toMatchObject({ status: "blocked", note: "Example supplier quote" });
  });

  it("imports only approved items, and adds nothing the second time", async () => {
    const items = prepareTeamBoard(exported, { people, companies });
    const first = await applyReview(board, arif, items);
    expect(first.imported.map((i) => i.title)).toEqual(items.filter((i) => i.approved).map((i) => i.title));
    const again = await applyReview(board, arif, items);
    expect(again.imported).toEqual([]);
    expect(again.skipped.every((s) => s.reason === "Already on the board.")).toBe(true);
  });

  it("reports a Task it can't add, without stopping the rest", async () => {
    const items = prepareTeamBoard(exported, { people: { u_one: "m-theran", u_two: "nobody@example.com", u_unknown: "m-arif" }, companies }).map((i) => ({
      ...i,
      approved: true,
    }));
    const result = await applyReview(board, arif, items);
    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toEqual([{ title: expect.stringContaining("Draft an example budget"), reason: expect.stringContaining("someone on the board") }]);
  });

  it("leaves a Task in Next when the company's Now is full, and says so", async () => {
    for (const title of ["Draft the plan", "Book the visit", "Order new parts"]) {
      await board.createTask(arif, { companyId: "c-hbf", departmentId: "operations", title, priority: "low", ownerIds: ["m-arif"], status: "now" });
    }
    const items = prepareTeamBoard(exported, { people, companies }).map((i) => ({ ...i, approved: true }));
    const result = await applyReview(board, arif, items);
    expect(result.notInNow).toEqual(["Check sample line speeds"]);
  });
});
