// The shape of the board's Microsoft Lists (ADR 0002). Shared by the Lists store and
// the provisioning script, so the two can't drift apart.

export type ColumnType = "text" | "note" | "boolean" | "number" | "json" | "datetime";

export interface Column {
  /** Entity field name. Stored as the same name with a capital first letter; `id` is stored as `Key`. */
  field: string;
  type: ColumnType;
  indexed?: boolean;
}

export interface ListSpec {
  name: string;
  /** Entity field shown in SharePoint's built-in Title column. */
  titleField: string;
  columns: Column[];
}

const key: Column = { field: "id", type: "text", indexed: true };

export const LISTS = {
  members: {
    name: "Board Members",
    titleField: "name",
    columns: [key, { field: "name", type: "text" }, { field: "email", type: "text" }],
  },
  companies: {
    name: "Board Companies",
    titleField: "name",
    columns: [
      key,
      { field: "name", type: "text" },
      { field: "kind", type: "text" },
      { field: "english", type: "text" },
      { field: "order", type: "number" },
    ],
  },
  areas: {
    name: "Board Areas",
    titleField: "name",
    columns: [
      key,
      { field: "companyId", type: "text", indexed: true },
      { field: "departmentId", type: "text" },
      { field: "name", type: "text" },
      { field: "retired", type: "boolean" },
    ],
  },
  tasks: {
    name: "Board Tasks",
    titleField: "title",
    columns: [
      key,
      { field: "companyId", type: "text", indexed: true },
      { field: "departmentId", type: "text" },
      { field: "areaId", type: "text" },
      { field: "title", type: "text" },
      { field: "status", type: "text" },
      { field: "priority", type: "text" },
      { field: "ownerIds", type: "json" },
      { field: "contributorIds", type: "json" },
      { field: "due", type: "text" },
      { field: "note", type: "note" },
      { field: "removed", type: "boolean" },
      { field: "leverId", type: "text" },
      { field: "createdAt", type: "text" },
      { field: "createdBy", type: "text" },
      { field: "updatedAt", type: "text" },
    ],
  },
  documents: {
    name: "Board Documents",
    titleField: "name",
    columns: [
      key,
      { field: "taskId", type: "text", indexed: true },
      { field: "kind", type: "text" },
      { field: "name", type: "text" },
      { field: "url", type: "note" },
      { field: "status", type: "text" },
      { field: "driveItemId", type: "text" },
      { field: "removed", type: "boolean" },
      { field: "createdAt", type: "text" },
      { field: "createdBy", type: "text" },
    ],
  },
  trail: {
    name: "Board Trail",
    titleField: "action",
    columns: [
      key,
      { field: "taskId", type: "text", indexed: true },
      { field: "companyId", type: "text", indexed: true },
      { field: "subject", type: "text" },
      { field: "subjectId", type: "text" },
      { field: "memberId", type: "text" },
      { field: "action", type: "text" },
      { field: "field", type: "text" },
      { field: "old", type: "note" },
      { field: "new", type: "note" },
      { field: "via", type: "text" },
      { field: "at", type: "datetime", indexed: true },
      { field: "outcome", type: "text" },
    ],
  },
} satisfies Record<string, ListSpec>;

export type ListName = keyof typeof LISTS;

export function columnName(field: string): string {
  return field === "id" ? "Key" : field[0]!.toUpperCase() + field.slice(1);
}

/** Entity → SharePoint list item fields. */
export function toFields(spec: ListSpec, entity: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = { Title: String(entity[spec.titleField] ?? "").slice(0, 255) };
  for (const col of spec.columns) {
    const value = entity[col.field];
    fields[columnName(col.field)] =
      col.type === "json" ? JSON.stringify(value ?? []) : value === undefined ? null : value;
  }
  return fields;
}

/** SharePoint list item fields → entity. */
export function fromFields<T>(spec: ListSpec, fields: Record<string, unknown>): T {
  const entity: Record<string, unknown> = {};
  for (const col of spec.columns) {
    const raw = fields[columnName(col.field)];
    switch (col.type) {
      case "json":
        entity[col.field] = typeof raw === "string" && raw ? JSON.parse(raw) : [];
        break;
      case "boolean":
        entity[col.field] = raw === true;
        break;
      case "number":
        entity[col.field] = typeof raw === "number" ? raw : Number(raw ?? 0);
        break;
      case "datetime":
        // SharePoint returns whole seconds; keep ISO strings comparable with ours.
        entity[col.field] = typeof raw === "string" ? new Date(raw).toISOString() : null;
        break;
      default:
        entity[col.field] = raw === undefined || raw === "" ? null : raw;
    }
  }
  return entity as T;
}
