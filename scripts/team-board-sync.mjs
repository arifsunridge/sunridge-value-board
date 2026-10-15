#!/usr/bin/env node
// The routine's half of the team board sync (ADR 0007), plain Node with no dependencies.
//
//   SYNC_TOKEN=... node scripts/team-board-sync.mjs <export dir> <out dir>
//
// <export dir> holds the artifact's collections as ArtifactData saves them with out_dir:
// actions/, categories/, documents/ and valueBoardSync/config.json, one JSON file per document.
// It posts them to the board, then writes each change for the artifact to <out dir>/writes/ and
// the batches to apply (50 writes each) to <out dir>/batches.json. It prints counts only.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [exportDir, outDir] = process.argv.slice(2);
const url = process.env.SYNC_URL ?? "https://sunridge-value-board.onrender.com/api/sync";
const token = process.env.SYNC_TOKEN;
if (!exportDir || !outDir) throw new Error("Usage: node scripts/team-board-sync.mjs <export dir> <out dir>");
if (!token) throw new Error("Set SYNC_TOKEN.");

function collection(name) {
  const dir = join(exportDir, name);
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), "utf8"))]),
  );
}

const config = collection("valueBoardSync").config;
if (!config) throw new Error("No valueBoardSync/config document in the export.");
const snapshot = { actions: collection("actions"), categories: collection("categories"), documents: collection("documents"), config };

const response = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(snapshot),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`The board answered ${response.status}: ${body.error ?? "no reason given"}`);

mkdirSync(join(outDir, "writes"), { recursive: true });
const writes = body.artifactWrites.map((w, i) => {
  const file = join(outDir, "writes", `${String(i).padStart(4, "0")}-${w.doc_id}.json`);
  writeFileSync(file, JSON.stringify(w.data, null, 2));
  return { op: w.op, collection: w.collection, doc_id: w.doc_id, file_path: file };
});
const batches = [];
for (let i = 0; i < writes.length; i += 50) batches.push(writes.slice(i, i + 50));
writeFileSync(join(outDir, "batches.json"), JSON.stringify(batches, null, 2));

console.log(
  JSON.stringify({
    sent: { actions: Object.keys(snapshot.actions).length },
    board: { created: body.board.created, updated: body.board.updated, notInNow: body.board.notInNow, failed: body.board.failed.length },
    teamBoard: { writes: writes.length, batches: batches.length },
    skipped: body.skipped.length,
  }),
);
