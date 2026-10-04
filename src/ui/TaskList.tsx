import Link from "next/link";
import { isOverdue } from "@/board/board";
import { PRIORITY_LABELS, STATUS_LABELS, departmentName, type Area, type Member, type Task } from "@/board/model";
import { formatDay, peopleNames } from "./format";

/** A plain list of Tasks, for reading rather than moving: the Summary and My Tasks. */
export function TaskList({
  tasks,
  members,
  areas,
  today,
  notes,
  empty = "Nothing here.",
}: {
  tasks: Task[];
  members: Member[];
  areas: Area[];
  today: string;
  notes?: Record<string, string>;
  empty?: string;
}) {
  if (!tasks.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="list">
      {tasks.map((t) => {
        const area = areas.find((a) => a.id === t.areaId);
        const late = isOverdue(t, today);
        return (
          <li key={t.id} className={`priority-${t.priority}`}>
            <span className="sr-only">{PRIORITY_LABELS[t.priority]} priority. </span>
            <Link href={`/c/${t.companyId}?task=${t.id}`}>{t.title}</Link>
            <div className="meta">
              {STATUS_LABELS[t.status]} · {departmentName(t.departmentId)}
              {area ? ` › ${area.name}` : ""} · {peopleNames(t.ownerIds, members)}
              {t.due ? ` · ${late ? "Overdue, " : "Due "}${formatDay(t.due)}` : " · No date"}
            </div>
            {t.status === "blocked" && t.note && <div className="meta">Waiting on: {t.note}</div>}
            {notes?.[t.id] && <div className="meta">{notes[t.id]}</div>}
          </li>
        );
      })}
    </ul>
  );
}
