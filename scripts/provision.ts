/**
 * Creates the board's Microsoft Lists on the SharePoint site, adds any missing
 * columns, and adds Companies. Safe to run more than once.
 *
 *   npm run provision -- --company "HBF:portfolio:US" --company "Sunridge:sunridge:UK"
 *
 * Needs the ENTRA_* certificate settings and SHAREPOINT_SITE_ID in .env, and the
 * app's Sites.Selected grant on that site with "write" or "manage" (ADR 0003).
 */
import { parseArgs } from "node:util";
import { Graph } from "@/server/graph";
import type { Config } from "@/server/config";
import { LISTS, columnName, type Column } from "@/store/lists-schema";
import { ListsStore } from "@/store/lists";
import type { Company } from "@/board/model";

function definition(col: Column) {
  const base = { name: columnName(col.field), indexed: col.indexed ?? false };
  switch (col.type) {
    case "boolean":
      return { ...base, boolean: {} };
    case "number":
      return { ...base, number: {} };
    case "datetime":
      return { ...base, dateTime: { format: "dateTime" } };
    case "note":
    case "json":
      return { ...base, indexed: false, text: { allowMultipleLines: true, textType: "plain" } };
    default:
      return { ...base, text: { maxLength: 255 } };
  }
}

async function main() {
  const { values } = parseArgs({ options: { company: { type: "string", multiple: true } } });
  const graph = Graph.fromConfig(process.env as unknown as Config);
  const existing = await graph.all<{ id: string; displayName: string }>(`${graph.site}/lists?$select=id,displayName`);

  for (const spec of Object.values(LISTS)) {
    const found = existing.find((l) => l.displayName === spec.name);
    if (!found) {
      await graph.request("POST", `${graph.site}/lists`, {
        displayName: spec.name,
        list: { template: "genericList" },
        columns: spec.columns.map(definition),
      });
      console.log(`Created list: ${spec.name}`);
      continue;
    }
    const columns = await graph.all<{ name: string }>(`${graph.site}/lists/${found.id}/columns?$select=name`);
    for (const col of spec.columns) {
      if (columns.some((c) => c.name === columnName(col.field))) continue;
      await graph.request("POST", `${graph.site}/lists/${found.id}/columns`, definition(col));
      console.log(`Added column ${columnName(col.field)} to ${spec.name}`);
    }
  }

  const store = new ListsStore(graph);
  const companies = await store.listCompanies();
  for (const [i, arg] of (values.company ?? []).entries()) {
    const [name, kind, english] = arg.split(":");
    if (!name || (kind !== "portfolio" && kind !== "sunridge") || (english !== "US" && english !== "UK")) {
      throw new Error(`Write companies as Name:portfolio|sunridge:US|UK, not "${arg}".`);
    }
    if (companies.some((c) => c.name === name)) continue;
    const company: Company = { id: `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, kind, english, order: companies.length + i + 1 };
    await store.putCompany(company);
    console.log(`Added company: ${name}`);
  }

  console.log("\nDone. Ask IT to give Members read-only access to this site (ADR 0003).");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
