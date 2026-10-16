import { afterAll, describe, expect, it } from "vitest";
import { Board } from "@/board/board";
import { MemoryStore } from "./memory";
import { MIGRATIONS, MysqlStore, WORKING_TABLES, grants } from "./mysql";
import { AREAS, COMPANIES, PEOPLE, TASKS } from "./seed";
import type { Store } from "./store";

async function seeded(store: Store): Promise<Store> {
  for (const m of PEOPLE) await store.putPerson(m);
  for (const a of AREAS) await store.putArea(a);
  for (const t of TASKS) await store.putTask(t);
  return store;
}

const opened: MysqlStore[] = [];
afterAll(async () => {
  await Promise.all(opened.map((s) => s.close()));
});

const stores: [string, () => Promise<Store>][] = [
  ["memory", async () => seeded(new MemoryStore({ companies: COMPANIES }))],
];

// Set TEST_DB_HOST (and TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME) to run the same checks on MySQL.
// The tests drop and recreate the board's tables in that database: never point it at a real one.
if (process.env.TEST_DB_HOST) {
  stores.push([
    "MySQL",
    async () => {
      const store = MysqlStore.connect({
        host: process.env.TEST_DB_HOST,
        port: Number(process.env.TEST_DB_PORT ?? 3306),
        user: process.env.TEST_DB_USER ?? "root",
        password: process.env.TEST_DB_PASSWORD ?? "",
        database: process.env.TEST_DB_NAME ?? "value_board_test",
      });
      opened.push(store);
      await store.dropAllForTests();
      await store.init(COMPANIES);
      return seeded(store);
    },
  ]);
}

describe.each(stores)("%s store", (_name, make) => {
  it("round-trips Projects, Task owner names and append-only Updates", async () => {
    const store = await make();
    const board = new Board(store, () => new Date("2026-10-04T10:00:00Z"));
    const actor = { memberId: "m-arif", via: "screen" as const };
    const project = await board.createProject(actor, {
      companyId: "c-hbf",
      departmentId: "innovation",
      areaId: "a-hbf-systems",
      name: "Example app",
      goal: "One place for the example data.",
      ownerName: "Example Colleague",
      phase: "building",
      repository: "example-org/example-app",
      liveUrl: "https://example.com/app",
    });
    expect(await store.getProject(project.id)).toEqual(project);
    const task = await board.createTask(actor, {
      companyId: "c-hbf",
      departmentId: "operations",
      title: "Ship the example app",
      priority: "medium",
      ownerNames: ["Example Colleague"],
      companyOwner: "Example Manager",
      projectId: project.id,
    });
    expect(await store.getTask(task.id)).toEqual(task);
    await board.addProjectUpdate(actor, project.id, { text: "First version is live." });
    expect((await store.listProjectUpdates({ projectId: project.id })).map((u) => u.text)).toEqual(["First version is live."]);
    expect((await store.listProjects({ companyId: "c-hbf" })).map((p) => p.id)).toEqual([project.id]);
  });

  it("round-trips Tasks, including empty notes, arrays and nulls", async () => {
    const store = await make();
    const task = await store.getTask("t-1");
    expect(task).toEqual(TASKS[0]);
    expect(await store.getTask("t-10")).toEqual(TASKS.find((t) => t.private));
    expect((await store.listTasks({ companyId: "c-sunridge" })).map((t) => t.id).sort()).toEqual(["t-10", "t-9"]);
    expect(await store.listTasks({})).toHaveLength(TASKS.length);
  });

  it("updates in place rather than duplicating", async () => {
    const store = await make();
    await store.putTask({ ...TASKS[0]!, title: "Analyze line speed gaps" });
    expect((await store.listTasks({ companyId: "c-hbf" })).filter((t) => t.id === "t-1")).toHaveLength(1);
    expect((await store.getTask("t-1"))!.title).toBe("Analyze line speed gaps");
  });

  it("supports the full board flow and Trail queries", async () => {
    const store = await make();
    const board = new Board(store, () => new Date("2026-10-04T10:00:00Z"));
    const actor = { memberId: "m-theran", via: "screen" as const };
    const task = await board.createTask(actor, {
      companyId: "c-hbf",
      departmentId: "operations",
      areaId: "a-hbf-warehouse",
      title: "Audit the cold store",
      priority: "low",
      ownerIds: ["m-theran"],
    });
    await board.addDocument(actor, task.id, { kind: "link", name: "Checklist", url: "https://example.com/checklist" });
    await board.moveTask(actor, task.id, { status: "blocked", waitingOn: "Quality lead's sign-off" });

    const detail = await board.task(actor, task.id);
    expect(detail.documents.map((d) => d.name)).toEqual(["Checklist"]);
    expect(detail.trail.map((e) => e.action)).toEqual(["created", "added", "moved", "changed"]);
    expect((await board.summary(actor, "c-hbf")).changes.find((c) => c.task.id === task.id)?.events).toEqual([
      "Added",
      "Document added",
      "Moved to Blocked",
    ]);
    expect((await board.board(actor, "c-hbf")).documentCounts[task.id]).toBe(1);
  });
});

describe("the board's database login", () => {
  const statements = grants("value_board");
  const on = (table: string) => statements.filter((g) => g.includes(`\`${table}\``));

  it("keeps the Trail and Project Updates append-only: insert and read, never change or reshape", () => {
    for (const table of ["vb_trail", "vb_project_updates"]) {
      expect(on(table)).toEqual([`GRANT SELECT, INSERT ON \`value_board\`.\`${table}\` TO 'value_board'@'%'`]);
    }
    expect(statements.join()).not.toMatch(/DELETE|DROP|ALL PRIVILEGES/);
  });

  it("may add every column a release brings, so they arrive on deploy without an admin", () => {
    for (const m of MIGRATIONS) {
      expect(WORKING_TABLES).toContain(m.table);
      expect(on(m.table).join()).toContain("ALTER");
    }
  });
});
