import type { Area, Company, Document, Member, Task, TrailEntry } from "@/board/model";
import type { Graph } from "@/server/graph";
import { LISTS, columnName, fromFields, toFields, type ListName } from "./lists-schema";
import type { Store } from "./store";

interface Item {
  id: string;
  fields: Record<string, unknown>;
}

// Lets filters on non-indexed columns run; every filter we send also uses an indexed column.
const PREFER = { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" };

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The board's data in Microsoft Lists on the board's SharePoint site, reached
 * through Graph as the app's own identity (ADR 0002, ADR 0003).
 */
export class ListsStore implements Store {
  private listIds: Promise<Record<ListName, string>> | undefined;
  /** Our Key → SharePoint item ID, per list, filled as items are read or written. */
  private itemIds = new Map<string, string>();

  constructor(private readonly graph: Graph) {}

  async listMembers() {
    return this.read<Member>("members");
  }
  async putMember(member: Member) {
    await this.put("members", member);
  }

  async listCompanies() {
    return (await this.read<Company>("companies")).sort((a, b) => a.order - b.order);
  }

  async listAreas(companyId: string) {
    return this.read<Area>("areas", `fields/CompanyId eq ${quote(companyId)}`);
  }
  async getArea(id: string) {
    return this.one<Area>("areas", id);
  }
  async putArea(area: Area) {
    await this.put("areas", area);
  }

  async listTasks(filter: { companyId?: string }) {
    const tasks = await this.read<Task>("tasks", filter.companyId ? `fields/CompanyId eq ${quote(filter.companyId)}` : undefined);
    return tasks.map(normaliseTask);
  }
  async getTask(id: string) {
    const task = await this.one<Task>("tasks", id);
    return task ? normaliseTask(task) : null;
  }
  async putTask(task: Task) {
    await this.put("tasks", task);
  }

  async listDocuments(filter: { taskIds: string[] }) {
    if (!filter.taskIds.length) return [];
    const ids = new Set(filter.taskIds);
    // Short lists use an OR filter on the indexed TaskId; whole boards read all Documents (a small list).
    const where =
      filter.taskIds.length <= 15 ? filter.taskIds.map((id) => `fields/TaskId eq ${quote(id)}`).join(" or ") : undefined;
    return (await this.read<Document>("documents", where)).filter((d) => ids.has(d.taskId));
  }
  async getDocument(id: string) {
    return this.one<Document>("documents", id);
  }
  async putDocument(doc: Document) {
    await this.put("documents", doc);
  }

  async appendTrail(entries: TrailEntry[]) {
    const lists = await this.lists();
    for (const entry of entries) {
      await this.graph.request("POST", `${this.graph.site}/lists/${lists.trail}/items`, {
        fields: toFields(LISTS.trail, { ...entry }),
      });
    }
  }
  async listTrail(filter: { taskId?: string; companyId?: string; since?: string }) {
    const where = [
      filter.taskId ? `fields/TaskId eq ${quote(filter.taskId)}` : null,
      filter.companyId ? `fields/CompanyId eq ${quote(filter.companyId)}` : null,
      filter.since ? `fields/At ge ${quote(filter.since)}` : null,
    ].filter(Boolean);
    return this.read<TrailEntry>("trail", where.length ? where.join(" and ") : undefined);
  }

  // ---------- internals ----------

  private lists(): Promise<Record<ListName, string>> {
    this.listIds ??= this.graph
      .all<{ id: string; displayName: string }>(`${this.graph.site}/lists?$select=id,displayName`)
      .then((found) => {
        const ids = {} as Record<ListName, string>;
        for (const [name, spec] of Object.entries(LISTS) as [ListName, (typeof LISTS)[ListName]][]) {
          const list = found.find((l) => l.displayName === spec.name);
          if (!list) throw new Error(`The SharePoint list "${spec.name}" is missing. Run the provisioning script.`);
          ids[name] = list.id;
        }
        return ids;
      })
      .catch((error) => {
        this.listIds = undefined;
        throw error;
      });
    return this.listIds;
  }

  private async items(list: ListName, filter?: string): Promise<Item[]> {
    const listId = (await this.lists())[list];
    const query = `$expand=fields&$top=999${filter ? `&$filter=${encodeURIComponent(filter)}` : ""}`;
    const items = await this.graph.all<Item>(`${this.graph.site}/lists/${listId}/items?${query}`, PREFER);
    for (const item of items) this.itemIds.set(`${list}:${item.fields[columnName("id")]}`, item.id);
    return items;
  }

  private async read<T>(list: ListName, filter?: string): Promise<T[]> {
    return (await this.items(list, filter)).map((i) => fromFields<T>(LISTS[list], i.fields));
  }

  private async one<T>(list: ListName, id: string): Promise<T | null> {
    const [first] = await this.read<T>(list, `fields/Key eq ${quote(id)}`);
    return first ?? null;
  }

  private async put(list: ListName, entity: { id: string }): Promise<void> {
    const listId = (await this.lists())[list];
    const cacheKey = `${list}:${entity.id}`;
    if (!this.itemIds.has(cacheKey)) await this.items(list, `fields/Key eq ${quote(entity.id)}`);
    const itemId = this.itemIds.get(cacheKey);
    const fields = toFields(LISTS[list], { ...entity });
    if (itemId) {
      await this.graph.request("PATCH", `${this.graph.site}/lists/${listId}/items/${itemId}/fields`, fields);
    } else {
      const created = await this.graph.request<Item>("POST", `${this.graph.site}/lists/${listId}/items`, { fields });
      this.itemIds.set(cacheKey, created.id);
    }
  }
}

function normaliseTask(task: Task): Task {
  return { ...task, note: task.note ?? "", areaId: task.areaId ?? null, due: task.due ?? null, leverId: task.leverId ?? null };
}
