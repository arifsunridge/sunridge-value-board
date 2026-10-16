import "server-only";
import { board, portal } from "./context";
import { config } from "./config";
import { personFromDirectory } from "./portal-person";

// The HBF Portal's list of people the board lets in, so colleagues who haven't signed in yet can
// be Owners (ADR 0009). Asked at most every ten minutes per server process.
const EVERY_MS = 10 * 60_000;
const holder = globalThis as unknown as { __svbPeopleAt?: number; __svbPeople?: Promise<void> };

/** Brings the board's people up to date from the Portal. If the Portal can't answer, the board keeps the people it has. */
export async function refreshPeople(): Promise<void> {
  if (config().AUTH_MODE !== "portal") return;
  if (holder.__svbPeople) return holder.__svbPeople;
  if (holder.__svbPeopleAt && Date.now() - holder.__svbPeopleAt < EVERY_MS) return;
  holder.__svbPeople = (async () => {
    try {
      const entries = await portal().listPeople();
      const people = entries.map((e) => personFromDirectory(e, config().PORTAL_COMPANY_ID)).filter((p) => p !== null);
      await board().recordDirectory(people);
      holder.__svbPeopleAt = Date.now();
    } catch (error) {
      // Names only: never anyone's details (ADR 0002).
      console.error("[people] Portal list failed:", error instanceof Error ? error.name : "unknown");
    } finally {
      holder.__svbPeople = undefined;
    }
  })();
  return holder.__svbPeople;
}
