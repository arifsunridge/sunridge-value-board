import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Board } from "@/board/board";
import { isMember } from "@/board/model";
import { applyBoardChanges, readBoardSide } from "./apply";
import { planSync, type TeamBoardSnapshot } from "./plan";

const record = <T extends z.ZodTypeAny>(item: T) => z.record(z.string(), item);

const snapshotSchema = z.object({
  actions: record(
    z
      .object({
        title: z.string(),
        status: z.string(),
        projectId: z.string(),
        priority: z.string().optional(),
        categoryId: z.string().nullable().optional(),
        groupId: z.string().nullable().optional(),
        due: z.string().nullable().optional(),
        ownerIds: z.array(z.string()).optional(),
        ownerNames: z.array(z.string()).optional(),
        hbfOwner: z.string().optional(),
        note: z.string().optional(),
        waitingOn: z.string().optional(),
        removed: z.boolean().optional(),
        createdAt: z.string().optional(),
        editedAt: z.string().optional(),
      })
      .loose(),
  ),
  categories: record(z.object({ name: z.string(), parentId: z.string().nullable(), projectId: z.string().nullable() }).loose()),
  groups: record(
    z
      .object({
        name: z.string(),
        note: z.string().optional(),
        projectId: z.string(),
        categoryId: z.string(),
        order: z.number().optional(),
        ownerId: z.string().optional(),
        ownerName: z.string().optional(),
        phase: z.string().optional(),
        repository: z.string().optional(),
        portalApp: z.string().optional(),
        liveUrl: z.string().optional(),
        log: z.array(z.object({ at: z.string(), by: z.string().optional(), byName: z.string().optional(), text: z.string() }).loose()).optional(),
        removed: z.boolean().optional(),
        createdAt: z.string().optional(),
        editedAt: z.string().optional(),
      })
      .loose(),
  ).optional(),
  documents: record(
    z
      .object({ taskId: z.string().nullable().optional(), kind: z.string(), status: z.string(), title: z.string(), url: z.string(), removed: z.boolean().optional() })
      .loose(),
  ).optional(),
  config: z.object({
    people: record(z.string().min(1)),
    projects: record(z.string()),
    newTaskProject: record(z.string()),
    syncAs: z.string(),
  }),
});

export interface SyncEndpointOptions {
  board: Board;
  /** The shared secret the scheduled sync sends. Unset means the endpoint is off. */
  token: string | undefined;
  /** The Member the sync acts as; the snapshot's syncAs must be them. */
  asEmail: string | undefined;
  now: () => Date;
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * The team board sync (ADR 0007): takes the artifact's collections, makes the board's changes,
 * and answers with the writes for the artifact. Content travels only in the request and response.
 */
export async function handleSync(request: Request, options: SyncEndpointOptions): Promise<Response> {
  if (!options.token || !options.asEmail) return json({ error: "The team board sync is switched off." }, 404);
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!given || !tokenMatches(given, options.token)) return json({ error: "Not allowed." }, 401);

  const parsed = snapshotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "That isn't a team board snapshot.", issues: parsed.error.issues.length }, 400);
  const snapshot = parsed.data as TeamBoardSnapshot;
  const asEmail = options.asEmail.toLowerCase();
  if (snapshot.config.people[snapshot.config.syncAs]?.toLowerCase() !== asEmail) {
    return json({ error: "The snapshot's syncAs isn't the Member this board syncs as." }, 403);
  }
  const me = await options.board.me({ id: asEmail }).catch(() => null);
  if (!me || !isMember(me)) return json({ error: "The syncing Member hasn't signed in to the board yet." }, 409);

  const actor = { memberId: me.id, via: "sync" as const };
  const side = await readBoardSide(options.board, actor);
  const plan = planSync(snapshot, side, options.now().toISOString());
  const result = await applyBoardChanges(options.board, actor, plan, side, snapshot.config);
  return json({ artifactWrites: plan.artifact, board: result, skipped: plan.skipped });
}
