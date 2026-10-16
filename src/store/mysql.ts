import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import type { Area, Company, Document, Person, Project, ProjectUpdate, Task, TrailEntry } from "@/board/model";
import type { Store } from "./store";

/**
 * The board's tables in its own `value_board` database on the Render MySQL (ADR 0006).
 * Created on start when missing. Times are ISO strings, so they sort and compare as text.
 * In production the database user may only INSERT and SELECT on vb_trail (docs/setup.md),
 * so the Trail stays append-only even for the app.
 */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS vb_people (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(191) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    company_id VARCHAR(64) NULL,
    signed_in_at VARCHAR(30) NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vb_companies (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    english CHAR(2) NOT NULL,
    sort_order INT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vb_areas (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL,
    department_id VARCHAR(32) NOT NULL,
    name VARCHAR(80) NOT NULL,
    retired TINYINT(1) NOT NULL,
    INDEX (company_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vb_tasks (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL,
    department_id VARCHAR(32) NOT NULL,
    area_id VARCHAR(64) NULL,
    title VARCHAR(200) NOT NULL,
    status VARCHAR(16) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    owner_ids TEXT NOT NULL,
    owner_names TEXT NULL,
    contributor_ids TEXT NOT NULL,
    company_owner VARCHAR(200) NOT NULL DEFAULT '',
    project_id VARCHAR(64) NULL,
    due CHAR(10) NULL,
    note VARCHAR(400) NOT NULL,
    shared TINYINT(1) NOT NULL,
    removed TINYINT(1) NOT NULL,
    lever_id VARCHAR(64) NULL,
    created_at VARCHAR(30) NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    updated_at VARCHAR(30) NOT NULL,
    INDEX (company_id),
    INDEX (project_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vb_projects (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL,
    department_id VARCHAR(32) NOT NULL,
    area_id VARCHAR(64) NULL,
    name VARCHAR(200) NOT NULL,
    goal VARCHAR(400) NOT NULL,
    owner_id VARCHAR(191) NULL,
    owner_name VARCHAR(200) NOT NULL,
    phase VARCHAR(16) NULL,
    repository VARCHAR(400) NOT NULL,
    portal_app VARCHAR(64) NOT NULL,
    live_url VARCHAR(400) NOT NULL,
    sort_order INT NOT NULL,
    removed TINYINT(1) NOT NULL,
    created_at VARCHAR(30) NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    updated_at VARCHAR(30) NOT NULL,
    INDEX (company_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vb_project_updates (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    company_id VARCHAR(64) NOT NULL,
    at VARCHAR(30) NOT NULL,
    by_id VARCHAR(191) NULL,
    by_name VARCHAR(200) NOT NULL,
    text TEXT NOT NULL,
    via VARCHAR(16) NOT NULL,
    INDEX (project_id),
    INDEX (company_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vb_documents (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    name VARCHAR(200) NOT NULL,
    url TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    drive_item_id VARCHAR(200) NULL,
    removed TINYINT(1) NOT NULL,
    created_at VARCHAR(30) NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    INDEX (task_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vb_trail (
    seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    task_id VARCHAR(64) NULL,
    company_id VARCHAR(64) NOT NULL,
    subject VARCHAR(16) NOT NULL,
    subject_id VARCHAR(64) NOT NULL,
    member_id VARCHAR(191) NOT NULL,
    action VARCHAR(32) NOT NULL,
    field VARCHAR(32) NULL,
    old TEXT NULL,
    new TEXT NULL,
    via VARCHAR(16) NOT NULL,
    at VARCHAR(30) NOT NULL,
    outcome VARCHAR(8) NOT NULL,
    INDEX (task_id),
    INDEX (company_id, at)
  )`,
];

/**
 * Columns added after the first release (ADR 0008, 0009). A new database gets them from SCHEMA;
 * an existing one gets them from `npm run db:init`, because the app's own login may not ALTER.
 */
export const MIGRATIONS: { table: string; column: string; definition: string; then?: string }[] = [
  // Until then the board knew only people who had signed in, so everyone already there has.
  { table: "vb_people", column: "signed_in_at", definition: "VARCHAR(30) NULL", then: "UPDATE vb_people SET signed_in_at = ? WHERE signed_in_at IS NULL" },
  { table: "vb_tasks", column: "owner_names", definition: "TEXT NULL" },
  { table: "vb_tasks", column: "company_owner", definition: "VARCHAR(200) NOT NULL DEFAULT ''" },
  { table: "vb_tasks", column: "project_id", definition: "VARCHAR(64) NULL, ADD INDEX (project_id)" },
];

/** The two Companies v1 starts with. Inserted only when missing; names can be changed in the database. */
export const STARTING_COMPANIES: Company[] = [
  { id: "hbf", name: "HBF", kind: "portfolio", english: "US", order: 1 },
  { id: "sunridge", name: "Sunridge", kind: "sunridge", english: "UK", order: 2 },
];

type Row = RowDataPacket & Record<string, unknown>;

const str = (v: unknown): string => String(v);
const opt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Number(v) === 1;
const ids = (v: unknown): string[] => (v === null || v === undefined ? [] : (JSON.parse(String(v)) as string[]));

export class MysqlStore implements Store {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  static connect(options: PoolOptions): MysqlStore {
    return new MysqlStore(mysql.createPool({ connectionLimit: 5, ...options }));
  }

  /** Creates missing tables and the starting Companies, once per process. */
  init(companies: Company[] = STARTING_COMPANIES): Promise<void> {
    this.ready ??= (async () => {
      for (const statement of SCHEMA) await this.pool.query(statement);
      await this.migrate();
      for (const c of companies) {
        await this.pool.execute("INSERT IGNORE INTO vb_companies (id, name, kind, english, sort_order) VALUES (?, ?, ?, ?, ?)", [
          c.id,
          c.name,
          c.kind,
          c.english,
          c.order,
        ]);
      }
    })().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  /** Adds any column in MIGRATIONS that is missing. Safe to run again. */
  async migrate(): Promise<void> {
    const [rows] = await this.pool.query<Row[]>(
      "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
    );
    const have = new Set(rows.map((r) => `${str(r.t)}.${str(r.c)}`));
    for (const m of MIGRATIONS.filter((m) => !have.has(`${m.table}.${m.column}`))) {
      try {
        await this.pool.query(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.definition}`);
        if (m.then) await this.pool.query(m.then, [new Date().toISOString()]);
      } catch {
        throw new Error(`The board's tables need new columns (${m.table}.${m.column}). Run npm run db:init with an admin login.`);
      }
    }
  }

  /** Tests only: start from empty tables. */
  async dropAllForTests(): Promise<void> {
    for (const table of ["vb_people", "vb_companies", "vb_areas", "vb_tasks", "vb_projects", "vb_project_updates", "vb_documents", "vb_trail"]) {
      await this.pool.query(`DROP TABLE IF EXISTS ${table}`);
    }
    this.ready = null;
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private async rows(sql: string, params: (string | number | null)[] = []): Promise<Row[]> {
    await this.init();
    const [rows] = await this.pool.execute<Row[]>(sql, params);
    return rows;
  }

  private async run(sql: string, params: (string | number | null)[]): Promise<void> {
    await this.init();
    await this.pool.execute(sql, params);
  }

  // ---------- people ----------

  async listPeople(): Promise<Person[]> {
    return (await this.rows("SELECT * FROM vb_people")).map((r) => ({
      id: str(r.id),
      name: str(r.name),
      email: str(r.email),
      kind: str(r.kind) as Person["kind"],
      companyId: opt(r.company_id),
      signedInAt: opt(r.signed_in_at),
    }));
  }

  async putPerson(p: Person): Promise<void> {
    await this.run(
      `INSERT INTO vb_people (id, name, email, kind, company_id, signed_in_at) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), kind = VALUES(kind), company_id = VALUES(company_id),
         signed_in_at = VALUES(signed_in_at)`,
      [p.id, p.name, p.email, p.kind, p.companyId, p.signedInAt],
    );
  }

  // ---------- companies and Areas ----------

  async listCompanies(): Promise<Company[]> {
    return (await this.rows("SELECT * FROM vb_companies ORDER BY sort_order")).map((r) => ({
      id: str(r.id),
      name: str(r.name),
      kind: str(r.kind) as Company["kind"],
      english: str(r.english) as Company["english"],
      order: Number(r.sort_order),
    }));
  }

  private area(r: Row): Area {
    return {
      id: str(r.id),
      companyId: str(r.company_id),
      departmentId: str(r.department_id) as Area["departmentId"],
      name: str(r.name),
      retired: bool(r.retired),
    };
  }

  async listAreas(companyId: string): Promise<Area[]> {
    return (await this.rows("SELECT * FROM vb_areas WHERE company_id = ?", [companyId])).map((r) => this.area(r));
  }

  async getArea(id: string): Promise<Area | null> {
    const [r] = await this.rows("SELECT * FROM vb_areas WHERE id = ?", [id]);
    return r ? this.area(r) : null;
  }

  async putArea(a: Area): Promise<void> {
    await this.run(
      `INSERT INTO vb_areas (id, company_id, department_id, name, retired) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE company_id = VALUES(company_id), department_id = VALUES(department_id), name = VALUES(name), retired = VALUES(retired)`,
      [a.id, a.companyId, a.departmentId, a.name, a.retired ? 1 : 0],
    );
  }

  // ---------- Tasks ----------

  private task(r: Row): Task {
    return {
      id: str(r.id),
      companyId: str(r.company_id),
      departmentId: str(r.department_id) as Task["departmentId"],
      areaId: opt(r.area_id),
      title: str(r.title),
      status: str(r.status) as Task["status"],
      priority: str(r.priority) as Task["priority"],
      ownerIds: ids(r.owner_ids),
      ownerNames: ids(r.owner_names),
      contributorIds: ids(r.contributor_ids),
      companyOwner: str(r.company_owner ?? ""),
      projectId: opt(r.project_id),
      due: opt(r.due),
      note: str(r.note),
      shared: bool(r.shared),
      removed: bool(r.removed),
      leverId: opt(r.lever_id),
      createdAt: str(r.created_at),
      createdBy: str(r.created_by),
      updatedAt: str(r.updated_at),
    };
  }

  async listTasks(filter: { companyId?: string }): Promise<Task[]> {
    const rows = filter.companyId
      ? await this.rows("SELECT * FROM vb_tasks WHERE company_id = ?", [filter.companyId])
      : await this.rows("SELECT * FROM vb_tasks");
    return rows.map((r) => this.task(r));
  }

  async getTask(id: string): Promise<Task | null> {
    const [r] = await this.rows("SELECT * FROM vb_tasks WHERE id = ?", [id]);
    return r ? this.task(r) : null;
  }

  async putTask(t: Task): Promise<void> {
    await this.run(
      `INSERT INTO vb_tasks (id, company_id, department_id, area_id, title, status, priority, owner_ids, owner_names, contributor_ids, company_owner, project_id, due, note, shared, removed, lever_id, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE company_id = VALUES(company_id), department_id = VALUES(department_id), area_id = VALUES(area_id),
         title = VALUES(title), status = VALUES(status), priority = VALUES(priority), owner_ids = VALUES(owner_ids),
         owner_names = VALUES(owner_names), contributor_ids = VALUES(contributor_ids), company_owner = VALUES(company_owner),
         project_id = VALUES(project_id), due = VALUES(due), note = VALUES(note), shared = VALUES(shared),
         removed = VALUES(removed), lever_id = VALUES(lever_id), updated_at = VALUES(updated_at)`,
      [
        t.id,
        t.companyId,
        t.departmentId,
        t.areaId,
        t.title,
        t.status,
        t.priority,
        JSON.stringify(t.ownerIds),
        JSON.stringify(t.ownerNames),
        JSON.stringify(t.contributorIds),
        t.companyOwner,
        t.projectId,
        t.due,
        t.note,
        t.shared ? 1 : 0,
        t.removed ? 1 : 0,
        t.leverId,
        t.createdAt,
        t.createdBy,
        t.updatedAt,
      ],
    );
  }

  // ---------- Projects ----------

  private project(r: Row): Project {
    return {
      id: str(r.id),
      companyId: str(r.company_id),
      departmentId: str(r.department_id) as Project["departmentId"],
      areaId: opt(r.area_id),
      name: str(r.name),
      goal: str(r.goal),
      ownerId: opt(r.owner_id),
      ownerName: str(r.owner_name),
      phase: opt(r.phase) as Project["phase"],
      repository: str(r.repository),
      portalApp: str(r.portal_app),
      liveUrl: str(r.live_url),
      order: Number(r.sort_order),
      removed: bool(r.removed),
      createdAt: str(r.created_at),
      createdBy: str(r.created_by),
      updatedAt: str(r.updated_at),
    };
  }

  async listProjects(filter: { companyId?: string }): Promise<Project[]> {
    const rows = filter.companyId
      ? await this.rows("SELECT * FROM vb_projects WHERE company_id = ?", [filter.companyId])
      : await this.rows("SELECT * FROM vb_projects");
    return rows.map((r) => this.project(r));
  }

  async getProject(id: string): Promise<Project | null> {
    const [r] = await this.rows("SELECT * FROM vb_projects WHERE id = ?", [id]);
    return r ? this.project(r) : null;
  }

  async putProject(p: Project): Promise<void> {
    await this.run(
      `INSERT INTO vb_projects (id, company_id, department_id, area_id, name, goal, owner_id, owner_name, phase, repository, portal_app, live_url, sort_order, removed, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE company_id = VALUES(company_id), department_id = VALUES(department_id), area_id = VALUES(area_id),
         name = VALUES(name), goal = VALUES(goal), owner_id = VALUES(owner_id), owner_name = VALUES(owner_name), phase = VALUES(phase),
         repository = VALUES(repository), portal_app = VALUES(portal_app), live_url = VALUES(live_url), sort_order = VALUES(sort_order),
         removed = VALUES(removed), updated_at = VALUES(updated_at)`,
      [
        p.id,
        p.companyId,
        p.departmentId,
        p.areaId,
        p.name,
        p.goal,
        p.ownerId,
        p.ownerName,
        p.phase,
        p.repository,
        p.portalApp,
        p.liveUrl,
        p.order,
        p.removed ? 1 : 0,
        p.createdAt,
        p.createdBy,
        p.updatedAt,
      ],
    );
  }

  // ---------- Project Updates (append-only) ----------

  async appendProjectUpdates(updates: ProjectUpdate[]): Promise<void> {
    for (const u of updates) {
      await this.run(
        `INSERT INTO vb_project_updates (id, project_id, company_id, at, by_id, by_name, text, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [u.id, u.projectId, u.companyId, u.at, u.by, u.byName, u.text, u.via],
      );
    }
  }

  async listProjectUpdates(filter: { projectId?: string; companyId?: string }): Promise<ProjectUpdate[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.projectId) (where.push("project_id = ?"), params.push(filter.projectId));
    if (filter.companyId) (where.push("company_id = ?"), params.push(filter.companyId));
    const sql = `SELECT * FROM vb_project_updates${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY at, seq`;
    return (await this.rows(sql, params)).map((r) => ({
      id: str(r.id),
      projectId: str(r.project_id),
      companyId: str(r.company_id),
      at: str(r.at),
      by: opt(r.by_id),
      byName: str(r.by_name),
      text: str(r.text),
      via: str(r.via) as ProjectUpdate["via"],
    }));
  }

  // ---------- Documents ----------

  private document(r: Row): Document {
    return {
      id: str(r.id),
      taskId: str(r.task_id),
      kind: str(r.kind) as Document["kind"],
      name: str(r.name),
      url: str(r.url),
      status: str(r.status) as Document["status"],
      driveItemId: opt(r.drive_item_id),
      removed: bool(r.removed),
      createdAt: str(r.created_at),
      createdBy: str(r.created_by),
    };
  }

  async listDocuments(filter: { taskIds: string[] }): Promise<Document[]> {
    if (!filter.taskIds.length) return [];
    const marks = filter.taskIds.map(() => "?").join(", ");
    return (await this.rows(`SELECT * FROM vb_documents WHERE task_id IN (${marks})`, filter.taskIds)).map((r) => this.document(r));
  }

  async getDocument(id: string): Promise<Document | null> {
    const [r] = await this.rows("SELECT * FROM vb_documents WHERE id = ?", [id]);
    return r ? this.document(r) : null;
  }

  async putDocument(d: Document): Promise<void> {
    await this.run(
      `INSERT INTO vb_documents (id, task_id, kind, name, url, status, drive_item_id, removed, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE task_id = VALUES(task_id), kind = VALUES(kind), name = VALUES(name), url = VALUES(url),
         status = VALUES(status), drive_item_id = VALUES(drive_item_id), removed = VALUES(removed)`,
      [d.id, d.taskId, d.kind, d.name, d.url, d.status, d.driveItemId, d.removed ? 1 : 0, d.createdAt, d.createdBy],
    );
  }

  // ---------- Trail (append-only) ----------

  async appendTrail(entries: TrailEntry[]): Promise<void> {
    for (const e of entries) {
      await this.run(
        `INSERT INTO vb_trail (id, task_id, company_id, subject, subject_id, member_id, action, field, old, new, via, at, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.id, e.taskId, e.companyId, e.subject, e.subjectId, e.memberId, e.action, e.field, e.old, e.new, e.via, e.at, e.outcome],
      );
    }
  }

  async listTrail(filter: { taskId?: string; companyId?: string; since?: string }): Promise<TrailEntry[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.taskId) (where.push("task_id = ?"), params.push(filter.taskId));
    if (filter.companyId) (where.push("company_id = ?"), params.push(filter.companyId));
    if (filter.since) (where.push("at >= ?"), params.push(filter.since));
    const sql = `SELECT * FROM vb_trail${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY at, seq`; // seq keeps the write order of entries made in the same millisecond
    return (await this.rows(sql, params)).map((r) => ({
      id: str(r.id),
      taskId: opt(r.task_id),
      companyId: str(r.company_id),
      subject: str(r.subject) as TrailEntry["subject"],
      subjectId: str(r.subject_id),
      memberId: str(r.member_id),
      action: str(r.action),
      field: opt(r.field),
      old: opt(r.old),
      new: opt(r.new),
      via: str(r.via) as TrailEntry["via"],
      at: str(r.at),
      outcome: str(r.outcome) as TrailEntry["outcome"],
    }));
  }
}
