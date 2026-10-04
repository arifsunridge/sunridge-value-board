import "server-only";
import { Board } from "@/board/board";
import { MemoryStore } from "@/store/memory";
import { demoSeed } from "@/store/seed";
import type { Store } from "@/store/store";
import { ListsStore } from "@/store/lists";
import { Graph } from "./graph";
import { config } from "./config";

// One store per server process. Kept on globalThis so local hot reloads don't reset the demo data.
const holder = globalThis as unknown as { __svbStore?: Store; __svbGraph?: Graph };

export function graph(): Graph {
  if (!holder.__svbGraph) holder.__svbGraph = Graph.fromConfig(config());
  return holder.__svbGraph;
}

function store(): Store {
  if (!holder.__svbStore) {
    holder.__svbStore = config().STORE === "lists" ? new ListsStore(graph()) : new MemoryStore(demoSeed());
  }
  return holder.__svbStore;
}

export function board(): Board {
  return new Board(store());
}
