import type { Area, Company, Person, Project, Task } from "@/board/model";
import type { Seed } from "./memory";

// Illustrative data for local work and tests. Invented Tasks, no real company figures.

const at = "2026-10-01T09:00:00.000Z";

export const PEOPLE: Person[] = [
  { id: "m-arif", name: "Arif Bayrak", email: "arif@example.com", kind: "member", companyId: null, signedInAt: at },
  { id: "m-theran", name: "Theran Example", email: "theran@example.com", kind: "member", companyId: null, signedInAt: at },
  { id: "m-jack", name: "Jack Example", email: "jack@example.com", kind: "member", companyId: null, signedInAt: at },
  { id: "m-hugues", name: "Hugues Example", email: "hugues@example.com", kind: "member", companyId: null, signedInAt: at },
  { id: "m-philipp", name: "Philipp Example", email: "philipp@example.com", kind: "member", companyId: null, signedInAt: at },
  // An invented person in the HBF team (ADR 0005), for local work and tests.
  { id: "h-jordan", name: "Jordan Example", email: "jordan@hbf.example", kind: "company", companyId: "c-hbf", signedInAt: at },
];

export const COMPANIES: Company[] = [
  { id: "c-hbf", name: "HBF", kind: "portfolio", english: "US", order: 1 },
  { id: "c-sunridge", name: "Sunridge", kind: "sunridge", english: "UK", order: 2 },
];

export const AREAS: Area[] = [
  { id: "a-hbf-newbiz", companyId: "c-hbf", departmentId: "sales", name: "New business", retired: false },
  { id: "a-hbf-manufacturing", companyId: "c-hbf", departmentId: "operations", name: "Manufacturing", retired: false },
  { id: "a-hbf-warehouse", companyId: "c-hbf", departmentId: "operations", name: "Warehouse & quality", retired: false },
  { id: "a-hbf-organisation", companyId: "c-hbf", departmentId: "talent", name: "Organization", retired: false },
  { id: "a-hbf-systems", companyId: "c-hbf", departmentId: "innovation", name: "Systems & tools", retired: false },
  { id: "a-hbf-reporting", companyId: "c-hbf", departmentId: "finance", name: "Reporting & controls", retired: false },
  { id: "a-sun-ai", companyId: "c-sunridge", departmentId: "innovation", name: "AI tools", retired: false },
];

const task = (t: Partial<Task> & Pick<Task, "id" | "companyId" | "departmentId" | "title">): Task => ({
  areaId: null,
  status: "next",
  priority: "medium",
  ownerIds: ["m-arif"],
  ownerNames: [],
  contributorIds: [],
  companyOwner: "",
  projectId: null,
  due: null,
  note: "",
  shared: false,
  removed: false,
  leverId: null,
  createdAt: at,
  createdBy: "m-arif",
  updatedAt: at,
  ...t,
});

export const TASKS: Task[] = [
  task({ id: "t-1", companyId: "c-hbf", departmentId: "operations", areaId: "a-hbf-manufacturing", title: "Analyze line speed gap", priority: "high", status: "now", ownerIds: ["m-theran"], contributorIds: ["m-arif", "h-jordan"], due: "2026-10-09", shared: true }),
  task({ id: "t-2", companyId: "c-hbf", departmentId: "operations", areaId: "a-hbf-manufacturing", title: "Record machine set rates", priority: "high", ownerIds: ["m-theran", "h-jordan"], due: "2026-10-09", shared: true }),
  task({ id: "t-3", companyId: "c-hbf", departmentId: "finance", areaId: "a-hbf-reporting", title: "Build finance baseline", priority: "high", status: "now", ownerIds: ["m-jack"], contributorIds: ["m-arif"], due: "2026-10-09" }),
  task({ id: "t-4", companyId: "c-hbf", departmentId: "finance", title: "Renew the credit facility", priority: "high", status: "blocked", ownerIds: ["m-jack"], due: "2026-10-15", note: "Lender term sheet" }),
  task({ id: "t-5", companyId: "c-hbf", departmentId: "strategy", title: "Prepare site visit data pack", priority: "medium", ownerIds: ["m-theran"], contributorIds: ["m-arif"], due: "2026-10-05" }),
  task({ id: "t-6", companyId: "c-hbf", departmentId: "sales", areaId: "a-hbf-newbiz", title: "Track weekly pipeline conversion", priority: "medium", ownerIds: ["m-arif"], shared: true }),
  task({ id: "t-7", companyId: "c-hbf", departmentId: "innovation", areaId: "a-hbf-systems", title: "Set up line-side screens", priority: "low", ownerIds: ["m-theran"], contributorIds: ["m-arif"], projectId: "p-1" }),
  task({ id: "t-8", companyId: "c-hbf", departmentId: "strategy", title: "Circulate structured meeting notes", priority: "low", status: "done", ownerIds: ["m-arif"], due: "2026-10-02" }),
  task({ id: "t-9", companyId: "c-sunridge", departmentId: "innovation", areaId: "a-sun-ai", title: "Pilot the value board", priority: "medium", status: "now", ownerIds: ["m-arif"], due: "2026-11-02" }),
];

export const PROJECTS: Project[] = [
  {
    id: "p-1",
    companyId: "c-hbf",
    departmentId: "innovation",
    areaId: "a-hbf-systems",
    name: "Example floor app",
    goal: "One screen per line for the shift's plan and stops.",
    ownerId: "m-theran",
    ownerName: "",
    phase: "building",
    repository: "example-org/example-floor-app",
    portalApp: "",
    liveUrl: "",
    order: 1,
    removed: false,
    createdAt: at,
    createdBy: "m-arif",
    updatedAt: at,
  },
];

export function demoSeed(): Seed {
  return { people: PEOPLE, companies: COMPANIES, areas: AREAS, tasks: TASKS, projects: PROJECTS, documents: [], trail: [] };
}
