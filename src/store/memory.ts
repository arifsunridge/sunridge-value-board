import type { Area, Company, Document, Member, Task, TrailEntry } from "@/board/model";
import type { Store } from "./store";

const copy = <T>(value: T): T => structuredClone(value);

export interface Seed {
  members?: Member[];
  companies?: Company[];
  areas?: Area[];
  tasks?: Task[];
  documents?: Document[];
  trail?: TrailEntry[];
}

/** In-memory store for tests and local work. Returns copies so callers can't mutate state. */
export class MemoryStore implements Store {
  private members = new Map<string, Member>();
  private companies = new Map<string, Company>();
  private areas = new Map<string, Area>();
  private tasks = new Map<string, Task>();
  private documents = new Map<string, Document>();
  private trail: TrailEntry[] = [];

  constructor(seed: Seed = {}) {
    seed.members?.forEach((m) => this.members.set(m.id, copy(m)));
    seed.companies?.forEach((c) => this.companies.set(c.id, copy(c)));
    seed.areas?.forEach((a) => this.areas.set(a.id, copy(a)));
    seed.tasks?.forEach((t) => this.tasks.set(t.id, copy(t)));
    seed.documents?.forEach((d) => this.documents.set(d.id, copy(d)));
    this.trail = copy(seed.trail ?? []);
  }

  async listMembers() {
    return [...this.members.values()].map(copy);
  }
  async putMember(member: Member) {
    this.members.set(member.id, copy(member));
  }

  async listCompanies() {
    return [...this.companies.values()].sort((a, b) => a.order - b.order).map(copy);
  }

  async listAreas(companyId: string) {
    return [...this.areas.values()].filter((a) => a.companyId === companyId).map(copy);
  }
  async getArea(id: string) {
    const area = this.areas.get(id);
    return area ? copy(area) : null;
  }
  async putArea(area: Area) {
    this.areas.set(area.id, copy(area));
  }

  async listTasks(filter: { companyId?: string }) {
    return [...this.tasks.values()]
      .filter((t) => !filter.companyId || t.companyId === filter.companyId)
      .map(copy);
  }
  async getTask(id: string) {
    const task = this.tasks.get(id);
    return task ? copy(task) : null;
  }
  async putTask(task: Task) {
    this.tasks.set(task.id, copy(task));
  }

  async listDocuments(filter: { taskIds: string[] }) {
    const ids = new Set(filter.taskIds);
    return [...this.documents.values()].filter((d) => ids.has(d.taskId)).map(copy);
  }
  async getDocument(id: string) {
    const doc = this.documents.get(id);
    return doc ? copy(doc) : null;
  }
  async putDocument(doc: Document) {
    this.documents.set(doc.id, copy(doc));
  }

  async appendTrail(entries: TrailEntry[]) {
    this.trail.push(...entries.map(copy));
  }
  async listTrail(filter: { taskId?: string; companyId?: string; since?: string }) {
    return this.trail
      .filter((e) => !filter.taskId || e.taskId === filter.taskId)
      .filter((e) => !filter.companyId || e.companyId === filter.companyId)
      .filter((e) => !filter.since || e.at >= filter.since)
      .map(copy);
  }
}
