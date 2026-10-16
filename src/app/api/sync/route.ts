import { connection } from "next/server";
import { config } from "@/server/config";
import { board } from "@/server/context";
import { refreshPeople } from "@/server/people-directory";
import { handleSync } from "@/sync/endpoint";

// The team board sync (ADR 0007), called by a scheduled Claude routine with SYNC_TOKEN.
export async function POST(request: Request): Promise<Response> {
  await connection();
  try {
    await refreshPeople();
    return await handleSync(request, { board: board(), token: config().SYNC_TOKEN, asEmail: config().SYNC_AS_EMAIL, now: () => new Date() });
  } catch (error) {
    // The error's name only: never Task content (ADR 0002).
    console.error("[sync] failed:", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "The sync stopped part way. Run it again: it carries on from where the boards differ." }, { status: 500 });
  }
}
