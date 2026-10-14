import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import type { Area, Company, Document, Person, Task, TrailEntry } from "@/board/model";
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
    company_id VARCHAR(64) NULL
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
    contributor_ids TEXT NOT NULL,
    due CHAR(10) NULL,
    note VARCHAR(400) NOT NULL,
    shared TINYINT(1) NOT NULL,
    removed TINYINT(1) NOT NULL,
    lever_id VARCHAR(64) NULL,
    created_at VARCHAR(30) NOT NULL,
    created_by VARCHAR(191) NOT NULL,
    updated_at VARCHAR(30) NOT NULL,
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

/** The two Companies v1 starts with. Inserted only when missing; names can be changed in the database. */
export const STARTING_COMPANIES: Company[] = [
  { id: "hbf", name: "HBF", kind: "portfolio", english: "US", order: 1 },
  { id: "sunridge", name: "Sunridge", kind: "sunridge", english: "UK", order: 2 },
];

type Row = RowDataPacket & Record<string, unknown>;

const str = (v: unknown): string => String(v);
const opt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Number(v) === 1;
const ids = (v: unknown): string[] => JSON.parse(String(v)) as string[];

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

  /** Tests only: start from empty tables. */
  async dropAllForTests(): Promise<void> {
    for (const table of ["vb_people", "vb_companies", "vb_areas", "vb_tasks", "vb_documents", "vb_trail"]) {
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
    }));
  }

  async putPerson(p: Person): Promise<void> {
    await this.run(
      `INSERT INTO vb_people (id, name, email, kind, company_id) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), kind = VALUES(kind), company_id = VALUES(company_id)`,
      [p.id, p.name, p.email, p.kind, p.companyId],
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
      contributorIds: ids(r.contributor_ids),
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
      `INSERT INTO vb_tasks (id, company_id, department_id, area_id, title, status, priority, owner_ids, contributor_ids, due, note, shared, removed, lever_id, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE company_id = VALUES(company_id), department_id = VALUES(department_id), area_id = VALUES(area_id),
         title = VALUES(title), status = VALUES(status), priority = VALUES(priority), owner_ids = VALUES(owner_ids),
         contributor_ids = VALUES(contributor_ids), due = VALUES(due), note = VALUES(note), shared = VALUES(shared),
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
        JSON.stringify(t.contributorIds),
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
