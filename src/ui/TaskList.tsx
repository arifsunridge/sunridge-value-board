import Link from "next/link";
import { isOverdue } from "@/board/board";
import { PRIORITY_LABELS, STATUS_LABELS, departmentName, type Area, type Person, type Task } from "@/board/model";
import { formatDay, ownerNames } from "./format";
import { PrivateMark } from "./PrivateMark";

/**
 * Tasks as aligned rows, for reading rather than moving: the Summary, My Tasks and a Project.
 * Columns are Task, Status, Owners (one per line) and Due; on a phone each row stacks.
 */
export function TaskList({
  tasks,
  members,
  areas,
  today,
  notes,
  empty = "Nothing here.",
}: {
  tasks: Task[];
  members: Person[];
  areas: Area[];
  today: string;
  notes?: Record<string, string>;
  empty?: string;
}) {
  if (!tasks.length) return <p className="muted tl-empty">{empty}</p>;
  return (
    <table className="tl">
      <thead>
        <tr>
          <th scope="col">Task</th>
          <th scope="col">Status</th>
          <th scope="col">Owners</th>
          <th scope="col">Due</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => {
          const area = areas.find((a) => a.id === t.areaId);
          const late = isOverdue(t, today);
          const owners = ownerNames(t, members);
          return (
            <tr key={t.id} className={`priority-${t.priority}`}>
              <td className="tl-task">
                <span className="sr-only">{PRIORITY_LABELS[t.priority]} priority. </span>
                <Link href={`/c/${t.companyId}?task=${t.id}`}>{t.title}</Link>
                {t.private && <PrivateMark />}
                <div className="meta">
                  {departmentName(t.departmentId)}
                  {area ? ` › ${area.name}` : ""}
                </div>
                {t.status === "blocked" && t.note && (
                  <div className="meta wait">
                    <b>Waiting on:</b> {t.note}
                  </div>
                )}
                {notes?.[t.id] && <div className="meta note">{notes[t.id]}</div>}
              </td>
              <td className={`tl-status s-${t.status}`} data-label="Status">
                {STATUS_LABELS[t.status]}
              </td>
              <td className="tl-owners" data-label="Owners">
                {owners.length ? owners.map((name) => <div key={name}>{name}</div>) : <span className="need">Needs an owner</span>}
                {t.companyOwner && (
                  <div className="tl-company" title="Company owner">
                    {t.companyOwner}
                  </div>
                )}
              </td>
              <td className={`tl-due${late ? " late" : ""}`} data-label="Due">
                {t.due ? (late ? `Late · ${formatDay(t.due)}` : formatDay(t.due)) : <span className="muted">No date</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
