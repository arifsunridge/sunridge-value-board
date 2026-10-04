import { describe, expect, it } from "vitest";
import { Board } from "@/board/board";
import { MemoryStore } from "./memory";
import { ListsStore } from "./lists";
import { LISTS } from "./lists-schema";
import { AREAS, COMPANIES, MEMBERS, TASKS } from "./seed";
import type { Store } from "./store";
import { FakeGraphServer } from "@/test/fake-graph";

async function seeded(store: Store): Promise<Store> {
  for (const m of MEMBERS) await store.putMember(m);
  for (const a of AREAS) await store.putArea(a);
  for (const t of TASKS) await store.putTask(t);
  return store;
}

const stores: [string, () => Promise<Store>][] = [
  ["memory", async () => seeded(new MemoryStore({ companies: COMPANIES }))],
  [
    "Microsoft Lists",
    async () => {
      const server = new FakeGraphServer(Object.values(LISTS).map((l) => l.name));
      const companies = [...server.lists.values()].find((l) => l.displayName === LISTS.companies.name)!;
      COMPANIES.forEach((c, i) =>
        companies.items.push({ id: `c${i}`, fields: { Key: c.id, Name: c.name, Kind: c.kind, English: c.english, Order: c.order } }),
      );
      return seeded(new ListsStore(server.graph()));
    },
  ],
];

describe.each(stores)("%s store", (_name, make) => {
  it("round-trips Tasks, including empty notes, arrays and nulls", async () => {
    const store = await make();
    const task = await store.getTask("t-1");
    expect(task).toEqual(TASKS[0]);
    expect((await store.listTasks({ companyId: "c-sunridge" })).map((t) => t.id)).toEqual(["t-9"]);
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

    const detail = await board.task(task.id);
    expect(detail.documents.map((d) => d.name)).toEqual(["Checklist"]);
    expect(detail.trail.map((e) => e.action)).toEqual(["created", "added", "moved", "changed"]);
    expect((await board.summary("c-hbf")).changes.find((c) => c.task.id === task.id)?.events).toEqual([
      "Added",
      "Document added",
      "Moved to Blocked",
    ]);
    expect((await board.board("c-hbf")).documentCounts[task.id]).toBe(1);
  });
});
