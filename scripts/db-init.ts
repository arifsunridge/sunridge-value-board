/**
 * Creates the board's tables and starting Companies in its MySQL database (ADR 0006). Run once,
 * with an admin login in DB_USER and DB_PASSWORD, then give the app its own login with the grants
 * this prints, so it can only add to the Trail, never change it.
 *
 *   DB_HOST=... DB_USER=<admin> DB_PASSWORD=... DB_NAME=value_board npm run db:init
 */
import { MysqlStore } from "@/store/mysql";

const TABLES = ["vb_people", "vb_companies", "vb_areas", "vb_tasks", "vb_documents"];

async function main() {
  const env = process.env;
  if (!env.DB_HOST || !env.DB_USER) throw new Error("Set DB_HOST, DB_USER (an admin login), DB_PASSWORD and DB_NAME.");
  if (/(^|\.)hbroch\.com$/i.test(env.DB_HOST)) throw new Error("That is the live HBF database. Use the Render MySQL.");
  const database = env.DB_NAME ?? "value_board";
  const store = MysqlStore.connect({
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD ?? "",
    database,
  });
  await store.init();
  await store.close();
  const app = "'value_board'@'%'";
  console.log(`Tables ready in ${database}. Give the app its own login (run as an admin):\n`);
  console.log(`CREATE USER IF NOT EXISTS ${app} IDENTIFIED BY '<a long random password>';`);
  console.log(`GRANT CREATE ON ${database}.* TO ${app};`);
  for (const t of TABLES) console.log(`GRANT SELECT, INSERT, UPDATE ON ${database}.${t} TO ${app};`);
  console.log(`GRANT SELECT, INSERT ON ${database}.vb_trail TO ${app};  -- append-only: no UPDATE or DELETE`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
