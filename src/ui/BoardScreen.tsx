"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { moveTask } from "@/app/actions";
import { isOverdue, type BoardView } from "@/board/board";
import {
  NOW_CAP,
  DEPARTMENTS,
  canBeShared,
  hasOwner,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type Area,
  type DepartmentId,
  type Person,
  type Status,
  type Task,
} from "@/board/model";
import { CompanyHead } from "./CompanyViews";
import { formatDay, ownerNames, shortNames } from "./format";
import { PrivateMark } from "./PrivateMark";

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "mine", label: "Mine" },
  { id: "private", label: "Private" },
  { id: "high", label: "High" },
  { id: "blocked", label: "Blocked" },
  { id: "overdue", label: "Late", alert: true },
  { id: "nodate", label: "No date" },
  { id: "noowner", label: "Needs an owner", alert: true },
] as const;

function matches(filter: string, t: Task, meId: string, today: string): boolean {
  switch (filter) {
    case "mine":
      return t.ownerIds.includes(meId) || t.contributorIds.includes(meId);
    case "private":
      return t.private;
    case "high":
      return t.priority === "high";
    case "blocked":
      return t.status === "blocked";
    case "overdue":
      return isOverdue(t, today);
    case "nodate":
      return t.status !== "done" && !t.due;
    case "noowner":
      return t.status !== "done" && !hasOwner(t);
    default:
      return true;
  }
}

const openCount = (tasks: Task[]) => tasks.filter((t) => t.status !== "done").length;
const openLabel = (n: number) => (n ? `${n} open` : "Nothing open");

interface Placement {
  id: string;
  status: Status;
  departmentId: DepartmentId;
  areaId: string | null;
}

const cellId = (departmentId: string, areaId: string | null, status: Status) => `${departmentId}|${areaId ?? ""}|${status}`;

function parseCell(id: string): {
  departmentId: DepartmentId;
  areaId: string | null;
  status: Status;
} {
  const [departmentId, areaId, status] = id.split("|");
  return {
    departmentId: departmentId as DepartmentId,
    areaId: areaId || null,
    status: status as Status,
  };
}

export function BoardScreen({
  view,
  members,
  meId,
  isCompanyTeam,
  today,
  filter,
  showEmpty,
  showProjects,
}: {
  view: BoardView;
  members: Person[];
  meId: string;
  /** The Company team sees Shared Tasks only and moves them between Statuses, not Areas (ADR 0005). */
  isCompanyTeam: boolean;
  today: string;
  filter: string;
  /** Show Departments and Areas with no Tasks, for dragging a Task into one. */
  showEmpty: boolean;
  /** Show each card's Project above its title. */
  showProjects: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [tasks, place] = useOptimistic(view.tasks, (current: Task[], p: Placement) =>
    current.map((t) =>
      t.id === p.id
        ? {
            ...t,
            status: p.status,
            departmentId: p.departmentId,
            areaId: p.areaId,
          }
        : t,
    ),
  );
  const [pendingBlocked, setPendingBlocked] = useState<Placement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const visible = tasks.filter((t) => matches(filter, t, meId, today));

  function open(taskId: string) {
    const next = new URLSearchParams(params);
    next.set("task", taskId);
    router.push(`?${next}`, { scroll: false });
  }

  function commit(p: Placement, waitingOn?: string) {
    setError(null);
    const before = tasks.find((t) => t.id === p.id);
    const sameHome = before?.departmentId === p.departmentId && before?.areaId === p.areaId;
    startTransition(async () => {
      place(p);
      const result = await moveTask(
        p.id,
        sameHome
          ? { status: p.status, waitingOn }
          : {
              status: p.status,
              departmentId: p.departmentId,
              areaId: p.areaId,
              waitingOn,
            },
      );
      if (!result.ok) setError(result.message);
    });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const task = tasks.find((t) => t.id === event.active.id);
    if (!task) return;
    const target = parseCell(String(event.over.id));
    if (target.status === task.status && target.departmentId === task.departmentId && target.areaId === task.areaId) return;
    if (isCompanyTeam && (target.departmentId !== task.departmentId || target.areaId !== task.areaId)) {
      setError("Only Sunridge can move a Task to another Department or Area. Move it between Statuses instead.");
      return;
    }
    const p = { id: task.id, ...target };
    if (target.status === "blocked" && task.status !== "blocked") setPendingBlocked(p);
    else commit(p);
  }

  const hrefWith = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    next.delete("task");
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };
  // Private Tasks don't take a place in Now (ADR 0010).
  const nowCount = tasks.filter((t) => t.status === "now" && !t.private).length;
  const departments = DEPARTMENTS.filter((d) => !isCompanyTeam || canBeShared(d.id));
  const nothingShown = !departments.some((d) => visible.some((t) => t.departmentId === d.id));
  const editable = new Set(view.editable);
  const projectNames = Object.fromEntries(view.projects.map((p) => [p.project.id, p.project.name]));

  return (
    <section className="company">
      <CompanyHead company={view.company} current="" isCompanyTeam={isCompanyTeam}>
        <span className={`stat${nowCount >= NOW_CAP ? " bad" : ""}`}>
          Now <b>{nowCount}</b> of {NOW_CAP}
        </span>
      </CompanyHead>

      <div className="filters">
        <span className="filters-l" id="filters-l">
          Show
        </span>
        <div className="chips" role="group" aria-labelledby="filters-l">
          {/* The Company team never sees a Private Task (ADR 0010), so they get no Private chip. */}
          {FILTERS.filter((f) => !(isCompanyTeam && f.id === "private")).map((f) => {
            const n = tasks.filter((t) => matches(f.id, t, meId, today)).length;
            return (
              <Link
                key={f.id}
                href={hrefWith("filter", f.id === "all" ? null : f.id)}
                className={`chip${"alert" in f && n > 0 ? " alert" : ""}`}
                aria-pressed={filter === f.id}
                scroll={false}
              >
                {f.label} <span className="n">{n}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="toolbar">
        {isCompanyTeam ? (
          <span className="muted small">You see the Tasks Sunridge shares with {view.company.name}.</span>
        ) : (
          <Link className="btn primary" href={`?task=new`} scroll={false}>
            Add task
          </Link>
        )}
        <span className="spacer" />
        {view.projects.length > 0 && (
          <Link className="toggle" href={hrefWith("projects", showProjects ? "0" : null)} scroll={false} aria-pressed={showProjects}>
            <span className="box" aria-hidden="true">
              {showProjects ? "✓" : ""}
            </span>
            Show Projects
          </Link>
        )}
        <Link className="toggle" href={hrefWith("empty", showEmpty ? null : "1")} scroll={false} aria-pressed={showEmpty}>
          <span className="box" aria-hidden="true">
            {showEmpty ? "✓" : ""}
          </span>
          Show empty areas
        </Link>
        <span className="legend" aria-hidden="true">
          <span>
            <i className="priority-high" />
            High
          </span>
          <span>
            <i className="priority-medium" />
            Medium
          </span>
          <span>
            <i className="priority-low" />
            Low
          </span>
        </span>
      </div>

      {view.tooManyHigh && !isCompanyTeam && (
        <p className="banner">
          More than a quarter of {view.company.name}&apos;s open Tasks are High. Would each one really miss a Target, or expose the
          business, if it slipped a week?
        </p>
      )}
      {error && (
        <p className="banner warn" role="alert">
          {error}
        </p>
      )}

      <DndContext id="board" sensors={sensors} onDragEnd={onDragEnd}>
        <div className="board">
          <div className="grid-h" aria-hidden="true">
            <div>Department · area</div>
            {STATUSES.map((s) => (
              <div key={s}>
                {STATUS_LABELS[s]}
                {s === "now" && <small> · up to {NOW_CAP}</small>}
              </div>
            ))}
          </div>
          {departments.map((d) => (
            <Department
              key={d.id}
              id={d.id}
              name={d.name}
              areas={view.areas.filter((a) => a.departmentId === d.id)}
              tasks={visible.filter((t) => t.departmentId === d.id)}
              showEmpty={showEmpty}
              members={members}
              meId={meId}
              showShared={!isCompanyTeam && view.company.kind === "portfolio"}
              today={today}
              documentCounts={view.documentCounts}
              editable={editable}
              projectNames={projectNames}
              showProjects={showProjects}
              companyName={view.company.name}
              onOpen={open}
            />
          ))}
          {nothingShown && !showEmpty && (
            <p className="empty">
              {filter === "all"
                ? isCompanyTeam
                  ? "Nothing is shared with you yet."
                  : "No Tasks yet. Add one, or tick Show empty areas to see every Department."
                : "Nothing matches this filter."}
            </p>
          )}
        </div>
      </DndContext>

      <WaitingOnDialog
        open={pendingBlocked !== null}
        onCancel={() => setPendingBlocked(null)}
        onConfirm={(waitingOn) => {
          if (pendingBlocked) commit(pendingBlocked, waitingOn);
          setPendingBlocked(null);
        }}
      />
    </section>
  );
}

function Department({
  id,
  name,
  areas,
  tasks,
  showEmpty,
  ...card
}: {
  id: DepartmentId;
  name: string;
  areas: Area[];
  tasks: Task[];
  showEmpty: boolean;
} & CardContext) {
  if (!showEmpty && !tasks.length) return null;
  const rows: { areaId: string | null; label: string }[] = [
    ...areas.map((a) => ({ areaId: a.id, label: a.name })),
    { areaId: null, label: "Whole department" },
  ];
  return (
    <div className="department" role="group" aria-label={name}>
      <div className="dept">
        <h3>{name}</h3>
        <small>{openLabel(openCount(tasks))}</small>
      </div>
      {rows.map((row) => {
        const rowTasks = tasks.filter((t) => t.areaId === row.areaId);
        if (!showEmpty && !rowTasks.length) return null;
        return (
          <div className="lane" key={row.areaId ?? "whole"}>
            <div className="lane-l">
              <b>{row.label}</b>
              <small>{openLabel(openCount(rowTasks))}</small>
            </div>
            {STATUSES.map((status) => (
              <Cell
                key={status}
                id={cellId(id, row.areaId, status)}
                status={status}
                label={`${name}${row.areaId ? `, ${row.label}` : ""}, ${STATUS_LABELS[status]}`}
                tasks={rowTasks.filter((t) => t.status === status)}
                {...card}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface CardContext {
  members: Person[];
  meId: string;
  /** Members see which Tasks the Company team can see. */
  showShared: boolean;
  today: string;
  documentCounts: Record<string, number>;
  /** The Tasks the signed-in Person may change (ADR 0009). */
  editable: Set<string>;
  projectNames: Record<string, string>;
  /** Shown on each card above its title; the toolbar can hide them. */
  showProjects: boolean;
  companyName: string;
  onOpen: (taskId: string) => void;
}

function Cell({ id, status, label, tasks, ...card }: { id: string; status: Status; label: string; tasks: Task[] } & CardContext) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [showDone, setShowDone] = useState(false);
  const collapsed = status === "done" && !showDone;
  return (
    <div
      ref={setNodeRef}
      className={`cell ${status}${isOver ? " over" : ""}`}
      data-label={STATUS_LABELS[status]}
      role="group"
      aria-label={label}
    >
      {!collapsed && tasks.map((t) => <Card key={t.id} task={t} {...card} />)}
      {status === "done" && tasks.length > 0 && (
        <button className="btn link more" onClick={() => setShowDone(!showDone)}>
          {showDone ? "Hide done" : `Show ${tasks.length} done`}
        </button>
      )}
    </div>
  );
}

function Card({ task, members, meId, companyName, showShared, showProjects, today, documentCounts, editable: mayChange, projectNames, onOpen }: { task: Task } & CardContext) {
  const editable = mayChange.has(task.id);
  const owners = ownerNames(task, members);
  const project = task.projectId ? projectNames[task.projectId] : undefined;
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: task.id, disabled: !editable });
  const late = isOverdue(task, today);
  return (
    <button
      ref={setNodeRef}
      className={`card p-${task.priority}${isDragging ? " dragging" : ""}${task.status === "done" ? " done" : ""}`}
      onClick={() => onOpen(task.id)}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
              position: "relative",
              zIndex: 5,
            }
          : undefined
      }
      // Viewers can open a Task but not drag it, so they get none of the drag attributes (which would mark the card disabled).
      {...(editable
        ? {
            ...attributes,
            ...listeners,
            "aria-roledescription": "Draggable Task",
          }
        : {})}
    >
      <span className="sr-only">{PRIORITY_LABELS[task.priority]} priority. </span>
      {showProjects && project && (
        <span className="ptag" title={`Project: ${project}`}>
          {project}
        </span>
      )}
      <span className="t">{task.title}</span>
      {task.status === "blocked" && task.note && <span className="w">{task.note}</span>}
      <span className="m">
        {task.due ? (
          <span className={late ? "late" : undefined}>{late ? `Late · ${formatDay(task.due)}` : formatDay(task.due)}</span>
        ) : (
          task.status !== "done" && <span>No date</span>
        )}
        {task.private && <PrivateMark />}
        {showShared && task.shared ? (
          <span className="shared-mark" title="Shared with the company team">
            Shared
          </span>
        ) : null}
        {documentCounts[task.id] ? (
          <span title="Has Documents">
            <Paperclip />
            <span className="sr-only">Has Documents</span>
          </span>
        ) : null}
      </span>
      <Owners task={task} owners={owners} me={members.find((m) => m.id === meId)?.name} companyName={companyName} />
    </button>
  );
}

/**
 * A card's people, at its foot in a ruled strip: each Owner by short name, typed names dashed,
 * and the company owner last, labelled with the Company. Full names in the title and for screen readers.
 */
function Owners({ task, owners, me, companyName }: { task: Task; owners: string[]; me?: string; companyName: string }) {
  if (!owners.length && !task.companyOwner && task.status === "done") return null;
  const typed = new Set(task.ownerNames);
  const short = shortNames(owners);
  const full = [...owners, ...(task.companyOwner ? [`${task.companyOwner} (${companyName})`] : [])].join(", ");
  return (
    <span className="card-owners" title={full || "Needs an owner"}>
      <span className="sr-only">{owners.length ? `Owners: ${owners.join(", ")}. ` : "Needs an owner. "}</span>
      {task.companyOwner && <span className="sr-only">{`${companyName} owner: ${task.companyOwner}.`}</span>}
      {!owners.length && <span className="need">Needs an owner</span>}
      {owners.map((name, i) => (
        <span key={name} className={`pp${typed.has(name) ? " named" : ""}${name === me ? " me" : ""}`} aria-hidden="true">
          {short[i]}
        </span>
      ))}
      {task.companyOwner && (
        <span className="pp company" aria-hidden="true">
          {companyName} · {shortNames([task.companyOwner])[0]}
        </span>
      )}
    </span>
  );
}

function WaitingOnDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: (text: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={onCancel}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const text = String(new FormData(e.currentTarget).get("waitingOn") ?? "").trim();
          if (text) onConfirm(text);
        }}
      >
        <h2>Waiting on?</h2>
        <div className="field">
          <label htmlFor="waitingOn">Who or what this Task is waiting on, in one line</label>
          <input id="waitingOn" name="waitingOn" type="text" maxLength={200} required autoFocus />
        </div>
        <div className="row">
          <button className="btn primary">Move to Blocked</button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Paperclip() {
  return (
    <svg className="clip" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7.5" />
    </svg>
  );
}
