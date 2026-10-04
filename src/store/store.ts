import type { Area, Company, Document, Member, Task, TrailEntry } from "@/board/model";

/**
 * Where board data lives. Two adapters: in-memory (tests, local work) and
 * Microsoft Lists (production, ADR 0002 and 0003). Only `board/` calls this;
 * the rules live there, not here.
 */
export interface Store {
  listMembers(): Promise<Member[]>;
  putMember(member: Member): Promise<void>;

  listCompanies(): Promise<Company[]>;

  listAreas(companyId: string): Promise<Area[]>;
  getArea(id: string): Promise<Area | null>;
  putArea(area: Area): Promise<void>;

  /** Tasks for one Company, or across all Companies when companyId is omitted. */
  listTasks(filter: { companyId?: string }): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  putTask(task: Task): Promise<void>;

  listDocuments(filter: { taskIds: string[] }): Promise<Document[]>;
  getDocument(id: string): Promise<Document | null>;
  putDocument(doc: Document): Promise<void>;

  /** Append-only: there is deliberately no update or delete. */
  appendTrail(entries: TrailEntry[]): Promise<void>;
  listTrail(filter: { taskId?: string; companyId?: string; since?: string }): Promise<TrailEntry[]>;
}
