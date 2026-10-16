/**
 * Creates the board's database, tables and starting Companies on the MySQL server (ADR 0006).
 * Run once, with an admin login in DB_USER and DB_PASSWORD.
 *
 * With DB_APP_PASSWORD set, it also creates (or updates) the board's own login, `value_board`,
 * with grants that let it add to the Trail but never change or delete it. Without it, it prints
 * those statements for an admin to run. Passwords are never printed.
 *
 *   DB_HOST=... DB_USER=<admin> DB_PASSWORD=... DB_NAME=value_board [DB_APP_PASSWORD=...] npm run db:init
 */
import mysql from "mysql2/promise";
import { MysqlStore } from "@/store/mysql";

const TABLES = ["vb_people", "vb_companies", "vb_areas", "vb_tasks", "vb_projects", "vb_documents"];
const APP_USER = "value_board";

/** The board's login: full use of its working tables, but only INSERT and SELECT on the Trail and on Project Updates. */
export function grants(database: string, user = `'${APP_USER}'@'%'`): string[] {
  return [
    `GRANT CREATE ON \`${database}\`.* TO ${user}`,
    ...TABLES.map((t) => `GRANT SELECT, INSERT, UPDATE ON \`${database}\`.\`${t}\` TO ${user}`),
    `GRANT SELECT, INSERT ON \`${database}\`.\`vb_trail\` TO ${user}`,
    `GRANT SELECT, INSERT ON \`${database}\`.\`vb_project_updates\` TO ${user}`,
  ];
}

async function main() {
  const env = process.env;
  if (!env.DB_HOST || !env.DB_USER) throw new Error("Set DB_HOST, DB_USER (an admin login), DB_PASSWORD and DB_NAME.");
  if (/(^|\.)hbroch\.com$/i.test(env.DB_HOST)) throw new Error("That is the live HBF database. Use the Render MySQL.");
  const database = env.DB_NAME ?? "value_board";
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error("DB_NAME may use letters, digits and underscores only.");
  const server = { host: env.DB_HOST, port: Number(env.DB_PORT ?? 3306), user: env.DB_USER, password: env.DB_PASSWORD ?? "" };

  const admin = await mysql.createConnection(server);
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  const store = MysqlStore.connect({ ...server, database });
  // init() creates missing tables and adds the columns later releases need (MIGRATIONS), as this admin login.
  await store.init();
  await store.close();
  console.log(`Tables ready in ${database}.`);

  if (env.DB_APP_PASSWORD) {
    if (env.DB_APP_PASSWORD.length < 24) throw new Error("DB_APP_PASSWORD must be at least 24 characters.");
    await admin.query(`CREATE USER IF NOT EXISTS '${APP_USER}'@'%' IDENTIFIED BY ?`, [env.DB_APP_PASSWORD]);
    await admin.query(`ALTER USER '${APP_USER}'@'%' IDENTIFIED BY ?`, [env.DB_APP_PASSWORD]);
    for (const statement of grants(database)) await admin.query(statement);
    console.log(`Login ${APP_USER} ready: it can add to the Trail but not change or delete it.`);
  } else {
    console.log(`\nGive the app its own login (run as an admin):\n`);
    console.log(`CREATE USER IF NOT EXISTS '${APP_USER}'@'%' IDENTIFIED BY '<a long random password>';`);
    for (const statement of grants(database)) console.log(`${statement};`);
  }
  await admin.end();
}

main().catch((error) => {
  // The error's message only: never the connection settings.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
