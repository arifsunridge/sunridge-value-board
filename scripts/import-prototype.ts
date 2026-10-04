/**
 * One-off import of the prototype board (spec P0.14). Two steps, so Arif reviews
 * every Task before anything reaches the board:
 *
 *   npm run import -- prepare <backup.json> --members private/members.json --out private/review.json
 *   (edit review.json: fix titles, owners and priority; set "approved": true)
 *   npm run import -- apply private/review.json --as <your member id>
 *
 * Keep backups and review files in private/ (git-ignored). They hold real company data.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Board } from "@/board/board";
import type { Config } from "@/server/config";
import { Graph } from "@/server/graph";
import { ListsStore } from "@/store/lists";
import { prepare, type Backup, type ReviewItem } from "./prototype";

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { members: { type: "string" }, out: { type: "string" }, as: { type: "string" } },
  });
  const [step, file] = positionals;

  if (step === "prepare" && file) {
    if (!values.members || !values.out) throw new Error("prepare needs --members and --out.");
    const backup = JSON.parse(readFileSync(file, "utf8")) as Backup;
    // members.json: { "Arif": "<member id>", "u_prototypeUserId": "<member id>", ... }
    const members = JSON.parse(readFileSync(values.members, "utf8")) as Record<string, string>;
    const items = prepare(backup, { members, companies: { "p-hbf": "HBF", "p-sunridge": "Sunridge" } });
    writeFileSync(values.out, JSON.stringify(items, null, 2));
    console.log(`Wrote ${items.length} Tasks to review. Set "approved": true on each one you want imported.`);
    return;
  }

  if (step === "apply" && file) {
    if (!values.as) throw new Error("apply needs --as <your member id>.");
    const items = (JSON.parse(readFileSync(file, "utf8")) as ReviewItem[]).filter((i) => i.approved);
    const store = new ListsStore(Graph.fromConfig(process.env as unknown as Config));
    const board = new Board(store);
    const actor = { memberId: values.as, via: "import" as const };
    const companies = await board.companies();
    for (const item of items) {
      const company = companies.find((c) => c.name === item.company);
      if (!company) throw new Error(`No company called ${item.company}. Run the provisioning script first.`);
      let areaId: string | null = null;
      if (item.area) {
        const areas = (await board.board(company.id)).areas;
        areaId =
          areas.find((a) => a.name === item.area && a.departmentId === item.departmentId)?.id ??
          (await board.createArea(actor, { companyId: company.id, departmentId: item.departmentId, name: item.area })).id;
      }
      // Imported Tasks start outside Now; the cap is applied when people move them.
      const task = await board.createTask(actor, {
        companyId: company.id,
        departmentId: item.departmentId,
        areaId,
        title: item.title,
        priority: item.priority,
        ownerIds: item.ownerIds,
        contributorIds: item.contributorIds,
        due: item.due,
        source: "Prototype board",
      });
      if (item.status !== "next" && item.status !== "now") {
        await board.moveTask(actor, task.id, { status: item.status, waitingOn: item.status === "blocked" ? "Check after import" : undefined });
      }
      console.log(`Imported: ${task.title}`);
    }
    console.log(`Done: ${items.length} Tasks.`);
    return;
  }

  throw new Error("Use: import-prototype prepare <backup.json> --members <file> --out <file> | apply <review.json> --as <member id>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
