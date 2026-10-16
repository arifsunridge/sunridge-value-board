import { beforeEach, describe, expect, it } from "vitest";
import { Board, type Actor } from "./board";
import { BoardError, titleHints } from "./rules";
import { NOW_CAP } from "./model";
import { MemoryStore } from "@/store/memory";
import { demoSeed } from "@/store/seed";
import type { Store } from "@/store/store";

const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** Titles that fill a Company's Now up to the cap, after the demo seed's 2. */
const NOW_FILLERS = NUMBERS.slice(0, NOW_CAP - 2).map((n) => `Draft plan ${n}`);

const arif: Actor = { memberId: "m-arif", via: "screen" };
const theran: Actor = { memberId: "m-theran", via: "screen" };
const hugues: Actor = { memberId: "m-hugues", via: "screen" };
const jack: Actor = { memberId: "m-jack", via: "screen" };

let store: MemoryStore;
let board: Board;
let seq = 0;

beforeEach(() => {
  store = new MemoryStore(demoSeed());
  seq = 0;
  board = new Board(store, () => new Date("2026-10-04T10:00:00Z"), () => `id-${++seq}`);
});

async function expectError(promise: Promise<unknown>, code: BoardError["code"]) {
  await expect(promise).rejects.toMatchObject({ name: "BoardError", code });
}

const newTask = (over: Partial<Parameters<Board["createTask"]>[1]> = {}) => ({
  companyId: "c-hbf",
  departmentId: "operations",
  areaId: "a-hbf-manufacturing",
  title: "Confirm the new line start date",
  priority: "medium" as const,
  ownerIds: ["m-arif"],
  ...over,
});

describe("creating a Task", () => {
  it("takes its Department from its Area and logs the creation", async () => {
    const task = await board.createTask(arif, newTask({ departmentId: "finance" }));
    expect(task.departmentId).toBe("operations");
    expect(task.status).toBe("next");
    const { trail } = await board.task(arif, task.id);
    expect(trail).toMatchObject([{ action: "created", memberId: "m-arif", via: "screen", new: task.title }]);
  });

  it("allows a Task with no Area, straight under its Department", async () => {
    const task = await board.createTask(arif, newTask({ areaId: null, departmentId: "strategy" }));
    expect(task).toMatchObject({ departmentId: "strategy", areaId: null });
  });

  it("refuses titles longer than eight words", async () => {
    await expectError(board.createTask(arif, newTask({ title: "one two three four five six seven eight nine" })), "invalid");
  });

  it("allows a Task with no Owner yet, but refuses an Owner id the board doesn't know (ADR 0009)", async () => {
    await expect(board.createTask(arif, newTask({ ownerIds: [] }))).resolves.toMatchObject({ ownerIds: [], ownerNames: [] });
    await expectError(board.createTask(arif, newTask({ ownerIds: ["someone-at-hbf"] })), "invalid");
  });

  it("takes Owners typed by name, and makes a name that is someone on the board that person", async () => {
    const task = await board.createTask(arif, newTask({ ownerIds: [], ownerNames: ["Example Colleague", "Jack Example", " example colleague "] }));
    expect(task).toMatchObject({ ownerIds: ["m-jack"], ownerNames: ["Example Colleague"] });
    await expectError(board.createTask(arif, newTask({ ownerNames: ["A", "B", "C", "D", "E", "F"] })), "invalid");
  });

  it("keeps the company owner as a name", async () => {
    const task = await board.createTask(arif, newTask({ companyOwner: "  Example   Manager " }));
    expect(task.companyOwner).toBe("Example Manager");
  });

  it("refuses a note longer than two lines", async () => {
    await expectError(board.createTask(arif, newTask({ note: "one\ntwo\nthree" })), "invalid");
  });

  it("refuses an Area from another Company", async () => {
    await expectError(board.createTask(arif, newTask({ companyId: "c-sunridge" })), "invalid");
  });

  it("drops an Owner from Contributors", async () => {
    const task = await board.createTask(arif, newTask({ ownerIds: ["m-arif"], contributorIds: ["m-arif", "m-jack"] }));
    expect(task.contributorIds).toEqual(["m-jack"]);
  });
});

describe("the Now cap", () => {
  async function fillNow() {
    // HBF starts with 2 in Now; fill the rest.
    for (const title of NOW_FILLERS) {
      await board.createTask(arif, newTask({ title, status: "now" }));
    }
  }

  it("refuses one more Task in Now than the cap for the same Company, naming the Company", async () => {
    await fillNow();
    const extra = await board.createTask(arif, newTask({ title: "Draft the extra plan" }));
    await expect(board.moveTask(arif, extra.id, { status: "now" })).rejects.toThrow(
      `HBF already has ${NOW_CAP} Tasks in Now. Move one out first.`,
    );
  });

  it("counts Tasks, not people: one Member may own several in Now", async () => {
    await fillNow();
    const view = await board.board(arif, "c-hbf");
    expect(view.nowCount).toBe(NOW_CAP);
  });

  it("is per Company: Sunridge's Now is separate", async () => {
    await fillNow();
    const task = await board.createTask(arif, newTask({ companyId: "c-sunridge", areaId: "a-sun-ai", title: "Draft guidance" }));
    await expect(board.moveTask(arif, task.id, { status: "now" })).resolves.toMatchObject({ status: "now" });
  });

  it("ignores removed Tasks, and restores into Next when Now is full", async () => {
    const extra = await board.createTask(arif, newTask({ title: "Draft extra", status: "now" }));
    await board.removeTask(arif, extra.id);
    await fillNow();
    const restored = await board.restoreTask(arif, extra.id);
    expect(restored).toMatchObject({ removed: false, status: "next" });
  });

  it("moves the later Task back if two moves race past the cap", async () => {
    await fillNow();
    // Simulate a race: someone else's write lands between our check and our write.
    const racing = new RacingStore(store, async () => {
      await store.putTask({ ...(await store.getTask("t-2"))!, status: "now" });
    });
    const racingBoard = new Board(racing, () => new Date("2026-10-04T10:00:00Z"));
    const t5 = (await store.getTask("t-5"))!;
    // Free a slot so our check passes, then the racer fills it.
    const anyNow = (await store.listTasks({ companyId: "c-hbf" })).find((t) => t.status === "now" && t.ownerIds.includes("m-arif"))!;
    await board.moveTask(arif, anyNow.id, { status: "next" });
    await expectError(racingBoard.moveTask(theran, t5.id, { status: "now" }), "now_cap");
    expect((await store.getTask("t-5"))!.status).toBe("next");
  });
});

describe("moving and Blocked", () => {
  it("asks what a Blocked Task is waiting on, and keeps the answer as the note", async () => {
    await expectError(board.moveTask(theran, "t-2", { status: "blocked" }), "waiting_on_required");
    const moved = await board.moveTask(theran, "t-2", { status: "blocked", waitingOn: "Plant manager's shift data" });
    expect(moved.note).toBe("Plant manager's shift data");
  });

  it("moves a Task between Areas inside its Company", async () => {
    const moved = await board.moveTask(theran, "t-2", { status: "next", areaId: "a-hbf-systems" });
    expect(moved).toMatchObject({ areaId: "a-hbf-systems", departmentId: "innovation" });
  });

  it("logs Company changes as an explicit move", async () => {
    const moved = await board.changeCompany(theran, "t-5", { companyId: "c-sunridge", departmentId: "operations" });
    expect(moved).toMatchObject({ companyId: "c-sunridge", areaId: null });
    const { trail } = await board.task(arif, "t-5");
    expect(trail.some((e) => e.field === "companyId" && e.old === "c-hbf" && e.new === "c-sunridge")).toBe(true);
  });
});

describe("who can change a Task", () => {
  it("lets Owners and Contributors edit, and refuses Viewers", async () => {
    await expect(board.updateTask(arif, "t-1", { priority: "medium" })).resolves.toBeTruthy(); // Contributor
    await expectError(board.updateTask(hugues, "t-1", { priority: "low" }), "not_allowed");
  });

  it("lets any Member join as a Contributor, on the Trail", async () => {
    const joined = await board.joinTask(hugues, "t-1");
    expect(joined.contributorIds).toContain("m-hugues");
    const { trail } = await board.task(arif, "t-1");
    expect(trail.at(-1)).toMatchObject({ action: "joined", memberId: "m-hugues" });
  });

  it("can leave a Task without an Owner", async () => {
    await expect(board.updateTask(theran, "t-2", { ownerIds: [] })).resolves.toMatchObject({ ownerIds: [] });
  });

  it("lets any Member change a Task none of whose Owners has signed in (ADR 0009)", async () => {
    await board.recordDirectory([{ id: "new@example.com", email: "new@example.com", name: "New Example", kind: "member", companyId: null, signedInAt: null }]);
    const theirs = await board.createTask(arif, newTask({ ownerIds: ["new@example.com"] }));
    await expect(board.updateTask(hugues, theirs.id, { due: "2026-11-02" })).resolves.toMatchObject({ due: "2026-11-02" });
    const named = await board.createTask(arif, newTask({ ownerIds: [], ownerNames: ["Example Colleague"] }));
    await expect(board.moveTask(hugues, named.id, { status: "now" })).resolves.toMatchObject({ status: "now" });
    // Once an Owner has signed in, only Owners and Contributors may change it again.
    await board.recordPerson({ id: "new@example.com", email: "new@example.com", name: "New Example", kind: "member", companyId: null, signedInAt: null });
    await expectError(board.updateTask(hugues, theirs.id, { due: "2026-11-03" }), "not_allowed");
  });

  it("never lets the HBF team change a Task just because its Owners haven't signed in", async () => {
    const named = await board.createTask(arif, newTask({ ownerIds: [], ownerNames: ["Example Colleague"], shared: true }));
    await expectError(board.updateTask({ memberId: "h-jordan", via: "screen" }, named.id, { due: "2026-11-02" }), "not_allowed");
  });
});

describe("the Trail", () => {
  it("records old and new values for each changed field", async () => {
    await board.updateTask(theran, "t-2", { priority: "low", due: "2026-10-20" });
    const { trail } = await board.task(arif, "t-2");
    expect(trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "priority", old: "high", new: "low" }),
        expect.objectContaining({ field: "due", old: "2026-10-09", new: "2026-10-20" }),
      ]),
    );
  });

  it("writes nothing when nothing changed", async () => {
    await board.updateTask(theran, "t-2", { priority: "high" });
    expect((await board.task(arif, "t-2")).trail).toHaveLength(0);
  });

  it("marks a failed write and hides it from the visible Trail", async () => {
    const failing = new FailingStore(store);
    const failingBoard = new Board(failing);
    await expect(failingBoard.updateTask(theran, "t-2", { priority: "low" })).rejects.toThrow("SharePoint unavailable");
    const raw = await store.listTrail({ taskId: "t-2" });
    expect(raw.map((e) => e.outcome)).toEqual(["ok", "failed"]);
    expect((await board.task(arif, "t-2")).trail).toHaveLength(0);
  });

  it("keeps a removed Task's Trail, and the Task can be restored", async () => {
    await board.removeTask(theran, "t-2");
    expect((await board.board(arif, "c-hbf")).tasks.some((t) => t.id === "t-2")).toBe(false);
    await board.restoreTask(theran, "t-2");
    const { trail } = await board.task(arif, "t-2");
    expect(trail.map((e) => e.action)).toEqual(["removed", "restored"]);
  });
});

describe("Documents", () => {
  const model = { kind: "file" as const, name: "Cash flow model", url: "https://sunridge.sharepoint.com/sites/board/model.xlsx", driveItemId: "item-1" };

  it("logs a new upload to the same file as a new Version of the same Document", async () => {
    const doc = await board.addDocument(theran, "t-5", model);
    const after = await board.replaceDocument(theran, doc.id, { url: model.url, driveItemId: "item-1" });
    expect(after.id).toBe(doc.id);
    const { trail } = await board.task(arif, "t-5");
    expect(trail.map((e) => e.action)).toEqual(["added", "new_version"]);
  });

  it("logs a replacement with the old and new links", async () => {
    const doc = await board.addDocument(theran, "t-5", { kind: "link", name: "Market note", url: "https://example.com/v2" });
    await board.replaceDocument(theran, doc.id, { url: "https://example.com/v3" });
    const { trail } = await board.task(arif, "t-5");
    expect(trail.at(-1)).toMatchObject({ action: "replaced", old: "https://example.com/v2", new: "https://example.com/v3" });
  });

  it("logs a move on both Tasks", async () => {
    const doc = await board.addDocument(theran, "t-5", model);
    await board.joinTask(theran, "t-4");
    await board.moveDocument(theran, doc.id, "t-4");
    expect((await board.task(arif, "t-5")).trail.at(-1)).toMatchObject({ action: "moved_out", new: "Renew the credit facility" });
    expect((await board.task(arif, "t-4")).trail.at(-1)).toMatchObject({ action: "moved_in", old: "Prepare site visit data pack" });
  });

  it("removes without erasing: the Trail keeps the name and last link, and it can be restored", async () => {
    const doc = await board.addDocument(theran, "t-5", model);
    await board.removeDocument(theran, doc.id);
    expect((await board.board(arif, "c-hbf")).documentCounts["t-5"]).toBeUndefined();
    const { trail } = await board.task(arif, "t-5");
    expect(trail.at(-1)).toMatchObject({ action: "removed", old: model.url, new: model.name });
    await board.restoreDocument(theran, doc.id);
    expect((await board.board(arif, "c-hbf")).documentCounts["t-5"]).toBe(1);
  });

  it("refuses values that aren't on the lists, even from a hand-made request", async () => {
    await expectError(board.moveTask(theran, "t-2", { status: "archived" as never }), "invalid");
    await expectError(board.addDocument(theran, "t-5", { kind: "video" as never, name: "Clip", url: "https://example.com" }), "invalid");
    const doc = await board.addDocument(theran, "t-5", { kind: "link", name: "Note", url: "https://example.com" });
    await expectError(board.updateDocument(theran, doc.id, { status: "approved" as never }), "invalid");
  });

  it("only accepts https links", async () => {
    await expectError(board.addDocument(theran, "t-5", { kind: "link", name: "Old site", url: "http://example.com" }), "invalid");
  });
});

describe("Areas", () => {
  it("moves open Tasks when an Area is retired", async () => {
    await board.retireArea(arif, "a-hbf-systems", { areaId: null });
    const task = await store.getTask("t-7");
    expect(task).toMatchObject({ areaId: null, departmentId: "innovation" });
    expect((await board.board(arif, "c-hbf")).areas.some((a) => a.id === "a-hbf-systems")).toBe(false);
  });

  it("refuses a duplicate Area name in the same Department", async () => {
    await expectError(board.createArea(arif, { companyId: "c-hbf", departmentId: "operations", name: "manufacturing" }), "invalid");
  });
});

describe("views", () => {
  it("warns when more than a quarter of open Tasks are High", async () => {
    expect((await board.board(arif, "c-hbf")).tooManyHigh).toBe(true); // 4 of 7 open
  });

  it("puts Blocked first in the Partner summary and flags overdue", async () => {
    const summary = await board.summary(arif, "c-hbf");
    expect(summary.attention[0]!.id).toBe("t-4");
    expect(summary.overdue.map((t) => t.id)).toEqual([]); // nothing due before 4 October is open
    await board.moveTask(theran, "t-2", { status: "done" });
    expect((await board.summary(arif, "c-hbf")).changes).toEqual([
      expect.objectContaining({ task: expect.objectContaining({ id: "t-2" }), events: ["Moved to Done"] }),
    ]);
  });

  it("shows a Member's Tasks across Companies", async () => {
    const mine = await board.myTasks({ memberId: "m-arif" });
    expect(new Set(mine.map((t) => t.companyId))).toEqual(new Set(["c-hbf", "c-sunridge"]));
  });
});

describe("title hints", () => {
  it("prompts for a verb and for names out of the title, without blocking", () => {
    expect(titleHints("Confirm the move date")).toEqual([]);
    expect(titleHints("Data pack — owner: Theran")).toHaveLength(2);
  });
});

const jordan: Actor = { memberId: "h-jordan", via: "screen" };

describe("Company teams and Shared Tasks (ADR 0005)", () => {
  it("shows the HBF team only its Company's Shared Tasks, everywhere", async () => {
    const view = await board.board(jordan, "c-hbf");
    expect(view.tasks.map((t) => t.id).sort()).toEqual(["t-1", "t-2", "t-6"]);
    expect(view.areas.map((a) => a.name)).not.toContain("Reporting & controls");
    const summary = await board.summary(jordan, "c-hbf");
    const ids = [...summary.attention, ...summary.overdue, ...summary.rest].map((t) => t.id);
    expect(ids.every((id) => ["t-1", "t-2", "t-6"].includes(id))).toBe(true);
    expect((await board.myTasks(jordan)).map((t) => t.id).sort()).toEqual(["t-1", "t-2"]);
  });

  it("answers not found for a Task that isn't shared, so its existence isn't revealed", async () => {
    await expectError(board.task(jordan, "t-4"), "not_found");
    await expectError(board.updateTask(jordan, "t-4", { note: "x" }), "not_found");
  });

  it("never shows the HBF team another Company, or Sunridge's own board", async () => {
    expect((await board.companies(jordan)).map((c) => c.id)).toEqual(["c-hbf"]);
    await expectError(board.board(jordan, "c-sunridge"), "not_found");
  });

  it("stops showing a Task the moment a Member stops sharing it", async () => {
    await board.shareTask(arif, "t-6", false);
    await expectError(board.task(jordan, "t-6"), "not_found");
  });

  it("lets the HBF team update the Status, due date and note of a Shared Task they own", async () => {
    const moved = await board.moveTask(jordan, "t-2", { status: "blocked", waitingOn: "Parts delivery" });
    expect(moved).toMatchObject({ status: "blocked", note: "Parts delivery" });
    const changed = await board.updateTask(jordan, "t-2", { due: "2026-10-20" });
    expect(changed.due).toBe("2026-10-20");
    const { trail } = await board.task(arif, "t-2");
    expect(trail.some((e) => e.memberId === "h-jordan" && e.field === "status")).toBe(true);
  });

  it("refuses the HBF team changes that stay with Sunridge", async () => {
    await expectError(board.updateTask(jordan, "t-2", { priority: "low" }), "not_allowed");
    await expectError(board.updateTask(jordan, "t-2", { ownerIds: ["h-jordan"] }), "not_allowed");
    await expectError(board.moveTask(jordan, "t-2", { status: "next", areaId: "a-hbf-systems" }), "not_allowed");
    await expectError(board.shareTask(jordan, "t-2", false), "not_allowed");
    await expectError(board.removeTask(jordan, "t-2"), "not_allowed");
    await expectError(board.createTask(jordan, newTask({ ownerIds: ["m-arif"], shared: true })), "not_allowed");
    await expectError(board.joinTask(jordan, "t-6"), "not_allowed");
    await expectError(board.createArea(jordan, { companyId: "c-hbf", departmentId: "sales", name: "Retail" }), "not_allowed");
    await expectError(board.removedTasks(jordan, "c-hbf"), "not_allowed");
  });

  it("refuses the HBF team changes to a Shared Task they don't own or help on", async () => {
    await expectError(board.updateTask(jordan, "t-6", { note: "x" }), "not_allowed");
  });

  it("lets the HBF team add Links, but not Files or Claude work", async () => {
    const link = await board.addDocument(jordan, "t-2", { kind: "link", name: "Rates sheet", url: "https://example.com/rates" });
    expect(link.kind).toBe("link");
    await expectError(
      board.addDocument(jordan, "t-2", { kind: "claude", name: "Analysis", url: "https://claude.ai/x" }),
      "not_allowed",
    );
  });

  it("never shares Talent & organisation or Finance", async () => {
    await expectError(board.shareTask(jack, "t-4", true), "invalid");
    await expectError(board.createTask(arif, newTask({ areaId: null, departmentId: "talent", shared: true })), "invalid");
    await expectError(board.moveTask(theran, "t-1", { status: "now", areaId: "a-hbf-reporting" }), "invalid");
  });

  it("lets the HBF team own only Shared Tasks in their Company", async () => {
    // A Shared Task may be owned by the HBF team alone; Sunridge no longer has to be an Owner (ADR 0009).
    await expect(board.updateTask(theran, "t-2", { ownerIds: ["h-jordan"] })).resolves.toMatchObject({ ownerIds: ["h-jordan"] });
    await expectError(board.updateTask(theran, "t-5", { contributorIds: ["h-jordan"] }), "invalid");
    await expectError(board.updateTask(theran, "t-5", { ownerIds: ["h-jordan"] }), "invalid");
    const task = await board.createTask(arif, newTask({ shared: true, ownerIds: ["m-arif", "h-jordan"] }));
    expect(task.ownerIds).toEqual(["m-arif", "h-jordan"]);
  });

  it("takes the HBF team off a Task when it stops being shared, on the Trail", async () => {
    const after = await board.shareTask(theran, "t-2", false);
    expect(after).toMatchObject({ shared: false, ownerIds: ["m-theran"] });
    const { trail } = await board.task(arif, "t-2");
    expect(trail.some((e) => e.action === "unshared")).toBe(true);
  });

  it("won't move a Shared Task to another Company", async () => {
    await expectError(board.changeCompany(theran, "t-2", { companyId: "c-sunridge", departmentId: "operations" }), "invalid");
  });

  it("tells the HBF team whom to ask when Now is full", async () => {
    for (const title of NOW_FILLERS) {
      await board.createTask(arif, newTask({ title, status: "now" }));
    }
    await expect(board.moveTask(jordan, "t-2", { status: "now" })).rejects.toThrow(/Ask Sunridge/);
  });

  it("refuses anyone the board doesn't know", async () => {
    await expectError(board.board({ memberId: "nobody@example.com" }, "c-hbf"), "not_allowed");
  });
});


/** A store whose task writes fail, to test the Trail's failure path. */
class FailingStore implements Store {
  constructor(private inner: Store) {}
  listPeople = () => this.inner.listPeople();
  putPerson = (m: Parameters<Store["putPerson"]>[0]) => this.inner.putPerson(m);
  listCompanies = () => this.inner.listCompanies();
  listAreas = (id: string) => this.inner.listAreas(id);
  getArea = (id: string) => this.inner.getArea(id);
  putArea = (a: Parameters<Store["putArea"]>[0]) => this.inner.putArea(a);
  listTasks = (f: Parameters<Store["listTasks"]>[0]) => this.inner.listTasks(f);
  getTask = (id: string) => this.inner.getTask(id);
  putTask = async (_task: Parameters<Store["putTask"]>[0]): Promise<void> => {
    throw new Error("SharePoint unavailable");
  };
  listDocuments = (f: Parameters<Store["listDocuments"]>[0]) => this.inner.listDocuments(f);
  getDocument = (id: string) => this.inner.getDocument(id);
  putDocument = (d: Parameters<Store["putDocument"]>[0]) => this.inner.putDocument(d);
  appendTrail = (e: Parameters<Store["appendTrail"]>[0]) => this.inner.appendTrail(e);
  listTrail = (f: Parameters<Store["listTrail"]>[0]) => this.inner.listTrail(f);
  listProjects = (f: Parameters<Store["listProjects"]>[0]) => this.inner.listProjects(f);
  getProject = (id: string) => this.inner.getProject(id);
  putProject = (p: Parameters<Store["putProject"]>[0]) => this.inner.putProject(p);
  appendProjectUpdates = (u: Parameters<Store["appendProjectUpdates"]>[0]) => this.inner.appendProjectUpdates(u);
  listProjectUpdates = (f: Parameters<Store["listProjectUpdates"]>[0]) => this.inner.listProjectUpdates(f);
}

/** A store where another write lands just before ours, to test the Now race. */
class RacingStore extends FailingStore {
  private raced = false;
  constructor(
    private readonly base: Store,
    private readonly race: () => Promise<void>,
  ) {
    super(base);
  }
  putTask = async (task: Parameters<Store["putTask"]>[0]) => {
    if (!this.raced) {
      this.raced = true;
      await this.race();
    }
    await this.base.putTask(task);
  };
}

describe("people from the HBF Portal (ADR 0009)", () => {
  const colleague = { id: "new@example.com", email: "new@example.com", name: "New Example", kind: "member" as const, companyId: null, signedInAt: null };

  it("adds people who haven't signed in, without marking them signed in", async () => {
    expect(await board.recordDirectory([colleague])).toBe(1);
    expect((await board.people(arif)).find((p) => p.id === colleague.id)).toMatchObject({ signedInAt: null });
    expect(await board.recordDirectory([colleague])).toBe(0);
  });

  it("records the first sign-in once, and the Portal list never clears it", async () => {
    await board.recordPerson(colleague);
    const signedIn = (await board.people(arif)).find((p) => p.id === colleague.id)!.signedInAt;
    expect(signedIn).toBe("2026-10-04T10:00:00.000Z");
    await board.recordDirectory([{ ...colleague, name: "New Example Renamed" }]);
    expect((await board.people(arif)).find((p) => p.id === colleague.id)).toMatchObject({ name: "New Example Renamed", signedInAt: signedIn });
  });
});
