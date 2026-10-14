import "server-only";
import { PortalClient } from "@arifsunridge/portal-kit";
import { Board } from "@/board/board";
import { MemoryStore } from "@/store/memory";
import { MysqlStore } from "@/store/mysql";
import { demoSeed } from "@/store/seed";
import type { Store } from "@/store/store";
import { config } from "./config";

// One store and one portal client per server process. Kept on globalThis so local hot reloads don't reset the demo data.
const holder = globalThis as unknown as { __svbStore?: Store; __svbPortal?: PortalClient };

function store(): Store {
  if (!holder.__svbStore) {
    const c = config();
    holder.__svbStore =
      c.STORE === "mysql"
        ? MysqlStore.connect({
            host: c.DB_HOST,
            port: c.DB_PORT,
            user: c.DB_USER,
            password: c.DB_PASSWORD,
            database: c.DB_NAME,
            ...(c.DB_SSL === "true" ? { ssl: {} } : {}),
          })
        : new MemoryStore(demoSeed());
  }
  return holder.__svbStore;
}

export function board(): Board {
  return new Board(store());
}

/** The HBF Portal's internal API: who may use the board, and activity reports (ids and paths only). */
export function portal(): PortalClient {
  if (!holder.__svbPortal) {
    const c = config();
    holder.__svbPortal = new PortalClient({
      baseUrl: c.PORTAL_INTERNAL_URL!,
      serviceToken: c.PORTAL_SERVICE_TOKEN!,
      app: c.PORTAL_APP_SLUG,
    });
  }
  return holder.__svbPortal;
}
