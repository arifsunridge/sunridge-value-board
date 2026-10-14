/**
 * One-off import of the prototype board (spec P0.14). Two steps, so Arif reviews
 * every Task before anything reaches the board:
 *
 *   npm run import -- prepare <backup.json> --members private/members.json --out private/review.json
 *   (edit review.json: fix titles, owners and priority; set "approved": true)
 *   npm run import -- apply private/review.json --as <your email>
 *
 * The team board artifact (its database export, one folder per collection) is prepared the same way,
 * then reviewed and imported on the board's Import screen by a Member:
 *
 *   npm run import -- prepare-team-board <export dir> --config private/team-board.json --out private/review.json
 *
 * where team-board.json is { "people": { "u_…": "<email>" }, "guessed": ["u_…"], "companies": { "p-hbf": "HBF" } }.
 *
 * Keep backups and review files in private/ (git-ignored). They hold real company data.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Board } from "@/board/board";
import { applyReview } from "@/import/apply";
import { MysqlStore } from "@/store/mysql";
import { prepareTeamBoard, type TeamBoardExport, type TeamBoardOptions } from "@/import/team-board";
import { prepare, type Backup, type ReviewItem } from "./prototype";

/** Reads one exported collection: <dir>/<collection>/<id>.json → { id: document }. */
function collection<T>(dir: string, name: string): Record<string, T> {
  const out: Record<string, T> = {};
  let files: string[] = [];
  try {
    files = readdirSync(join(dir, name)).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, name, f), "utf8")) as T;
  return out;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { members: { type: "string" }, out: { type: "string" }, as: { type: "string" }, config: { type: "string" } },
  });
  const [step, file] = positionals;

  if (step === "prepare" && file) {
    if (!values.members || !values.out) throw new Error("prepare needs --members and --out.");
    const backup = JSON.parse(readFileSync(file, "utf8")) as Backup;
    // members.json: { "Arif": "<email>", "u_prototypeUserId": "<email>", ... }. A Person's id is their lower-cased email (ADR 0006).
    const members = JSON.parse(readFileSync(values.members, "utf8")) as Record<string, string>;
    const items = prepare(backup, { members, companies: { "p-hbf": "HBF", "p-sunridge": "Sunridge" } });
    writeFileSync(values.out, JSON.stringify(items, null, 2));
    console.log(`Wrote ${items.length} Tasks to review. Set "approved": true on each one you want imported.`);
    return;
  }

  if (step === "prepare-team-board" && file) {
    if (!values.config || !values.out) throw new Error("prepare-team-board needs --config and --out.");
    const data: TeamBoardExport = {
      projects: collection(file, "projects"),
      categories: collection(file, "categories"),
      actions: collection(file, "actions"),
      documents: collection(file, "documents"),
    };
    const options = JSON.parse(readFileSync(values.config, "utf8")) as TeamBoardOptions;
    const items = prepareTeamBoard(data, options);
    writeFileSync(values.out, JSON.stringify(items, null, 2));
    const flagged = items.filter((i) => i.check.length).length;
    console.log(`Wrote ${items.length} Tasks to review (${flagged} to check). Import them on the board's Import screen.`);
    return;
  }

  if (step === "apply" && file) {
    if (!values.as) throw new Error("apply needs --as <your email>. Sign in to the board once first, so it knows you.");
    const items = (JSON.parse(readFileSync(file, "utf8")) as ReviewItem[]).filter((i) => i.approved);
    const env = process.env;
    if (!env.DB_HOST) throw new Error("apply needs DB_HOST (and DB_USER, DB_PASSWORD, DB_NAME) for the board's MySQL database.");
    const store = MysqlStore.connect({
      host: env.DB_HOST,
      port: Number(env.DB_PORT ?? 3306),
      user: env.DB_USER ?? "value_board",
      password: env.DB_PASSWORD ?? "",
      database: env.DB_NAME ?? "value_board",
    });
    const actor = { memberId: values.as, via: "import" as const };
    const result = await applyReview(new Board(store), actor, items);
    for (const t of result.imported) console.log(`Imported: ${t.title}`);
    for (const t of result.notInNow) console.log(`In Next, as Now was full: ${t}`);
    for (const t of result.skipped) console.log(`Skipped: ${t.title} (${t.reason})`);
    await store.close();
    console.log(`Done: ${result.imported.length} of ${items.length} approved Tasks imported.`);
    return;
  }

  throw new Error(
    "Use: import-prototype prepare <backup.json> --members <file> --out <file> | prepare-team-board <export dir> --config <file> --out <file> | apply <review.json> --as <your email>",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
