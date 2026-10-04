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
import { canEdit, isOverdue, type BoardView } from "@/board/board";
import {
  DEPARTMENTS,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type Area,
  type DepartmentId,
  type Member,
  type Status,
  type Task,
} from "@/board/model";
import { formatDay, peopleInitials, peopleNames } from "./format";

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "mine", label: "Mine" },
  { id: "high", label: "High" },
  { id: "blocked", label: "Blocked" },
  { id: "overdue", label: "Overdue" },
  { id: "nodate", label: "No date" },
] as const;

interface Placement {
  id: string;
  status: Status;
  departmentId: DepartmentId;
  areaId: string | null;
}

const cellId = (departmentId: string, areaId: string | null, status: Status) => `${departmentId}|${areaId ?? ""}|${status}`;

function parseCell(id: string): { departmentId: DepartmentId; areaId: string | null; status: Status } {
  const [departmentId, areaId, status] = id.split("|");
  return { departmentId: departmentId as DepartmentId, areaId: areaId || null, status: status as Status };
}

export function BoardScreen({
  view,
  members,
  meId,
  today,
  filter,
}: {
  view: BoardView;
  members: Member[];
  meId: string;
  today: string;
  filter: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [tasks, place] = useOptimistic(view.tasks, (current: Task[], p: Placement) =>
    current.map((t) => (t.id === p.id ? { ...t, status: p.status, departmentId: p.departmentId, areaId: p.areaId } : t)),
  );
  const [pendingBlocked, setPendingBlocked] = useState<Placement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const visible = tasks.filter((t) => {
    switch (filter) {
      case "mine":
        return t.ownerIds.includes(meId) || t.contributorIds.includes(meId);
      case "high":
        return t.priority === "high";
      case "blocked":
        return t.status === "blocked";
      case "overdue":
        return isOverdue(t, today);
      case "nodate":
        return t.status !== "done" && !t.due;
      default:
        return true;
    }
  });

  function open(taskId: string) {
    const next = new URLSearchParams(params);
    next.set("task", taskId);
    router.push(`?${next}`, { scroll: false });
  }

  function commit(p: Placement, waitingOn?: string) {
    setError(null);
    startTransition(async () => {
      place(p);
      const result = await moveTask(p.id, { status: p.status, departmentId: p.departmentId, areaId: p.areaId, waitingOn });
      if (!result.ok) setError(result.message);
    });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const task = tasks.find((t) => t.id === event.active.id);
    if (!task) return;
    const target = parseCell(String(event.over.id));
    if (target.status === task.status && target.departmentId === task.departmentId && target.areaId === task.areaId) return;
    const p = { id: task.id, ...target };
    if (target.status === "blocked" && task.status !== "blocked") setPendingBlocked(p);
    else commit(p);
  }

  const filterHref = (id: string) => {
    const next = new URLSearchParams(params);
    next.delete("task");
    if (id === "all") next.delete("filter");
    else next.set("filter", id);
    const qs = next.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <>
      <div className="toolbar">
        <div className="chips" aria-label="Show">
          {FILTERS.map((f) => (
            <Link key={f.id} href={filterHref(f.id)} className="chip" aria-current={filter === f.id ? "page" : undefined} scroll={false}>
              {f.label}
            </Link>
          ))}
        </div>
        <span className="spacer" />
        <Link className="button" href={`?task=new`} scroll={false}>
          Add task
        </Link>
      </div>

      {view.tooManyHigh && (
        <p className="banner">
          More than a quarter of {view.company.name}&apos;s open Tasks are High. Would each one really miss a Target, or
          expose the business, if it slipped a week?
        </p>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="board">
          <div className="grid">
            <div className="grid-head" aria-hidden="true">
              <div />
              {STATUSES.map((s) => (
                <div key={s}>
                  {STATUS_LABELS[s]}
                  {s === "now" && <span className="muted small"> · up to 5</span>}
                </div>
              ))}
            </div>
            {DEPARTMENTS.map((d) => (
              <Department
                key={d.id}
                id={d.id}
                name={d.name}
                areas={view.areas.filter((a) => a.departmentId === d.id)}
                tasks={visible.filter((t) => t.departmentId === d.id)}
                filtered={filter !== "all"}
                members={members}
                meId={meId}
                today={today}
                documentCounts={view.documentCounts}
                onOpen={open}
              />
            ))}
          </div>
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
    </>
  );
}

function Department({
  id,
  name,
  areas,
  tasks,
  filtered,
  ...card
}: {
  id: DepartmentId;
  name: string;
  areas: Area[];
  tasks: Task[];
  filtered: boolean;
} & CardContext) {
  const open = tasks.some((t) => t.status !== "done");
  if (filtered && !tasks.length) return null;
  const rows: { areaId: string | null; label: string }[] = [
    ...areas.map((a) => ({ areaId: a.id, label: a.name })),
    { areaId: null, label: areas.length ? "Whole department" : "" },
  ];
  return (
    <details className="department" open={open}>
      <summary>
        <h2>{name}</h2>
        {!open && <span className="muted small">{tasks.length ? "Nothing open" : "No Tasks yet"}</span>}
      </summary>
      {rows.map((row) => (
        <div className="grid-row" key={row.areaId ?? "whole"}>
          <div className="area-label">{row.label}</div>
          {STATUSES.map((status) => (
            <Cell
              key={status}
              id={cellId(id, row.areaId, status)}
              label={`${name}${row.label ? `, ${row.label}` : ""}, ${STATUS_LABELS[status]}`}
              tasks={tasks.filter((t) => t.areaId === row.areaId && t.status === status)}
              collapsed={status === "done"}
              {...card}
            />
          ))}
        </div>
      ))}
    </details>
  );
}

interface CardContext {
  members: Member[];
  meId: string;
  today: string;
  documentCounts: Record<string, number>;
  onOpen: (taskId: string) => void;
}

function Cell({ id, label, tasks, collapsed, ...card }: { id: string; label: string; tasks: Task[]; collapsed: boolean } & CardContext) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [showDone, setShowDone] = useState(false);
  const shown = collapsed && !showDone ? [] : tasks;
  return (
    <div ref={setNodeRef} className={`cell${isOver ? " over" : ""}`} role="group" aria-label={label}>
      {shown.map((t) => (
        <Card key={t.id} task={t} {...card} />
      ))}
      {collapsed && tasks.length > 0 && (
        <button className="button quiet show-done" onClick={() => setShowDone(!showDone)}>
          {showDone ? "Hide done" : "Show done"}
        </button>
      )}
    </div>
  );
}

function Card({ task, members, meId, today, documentCounts, onOpen }: { task: Task } & CardContext) {
  const editable = canEdit(task, meId);
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: task.id, disabled: !editable });
  const late = isOverdue(task, today);
  return (
    <button
      ref={setNodeRef}
      className={`card priority-${task.priority}${isDragging ? " dragging" : ""}${task.status === "done" ? " done" : ""}`}
      onClick={() => onOpen(task.id)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, position: "relative", zIndex: 5 } : undefined}
      // Viewers can open a Task but not drag it, so they get none of the drag attributes (which would mark the card disabled).
      {...(editable ? { ...attributes, ...listeners, "aria-roledescription": "Draggable Task" } : {})}
    >
      <span className="sr-only">{PRIORITY_LABELS[task.priority]} priority. </span>
      <div className="title">{task.title}</div>
      {task.status === "blocked" && task.note && <div className="waiting">Waiting on: {task.note}</div>}
      <div className="meta">
        <span title={peopleNames(task.ownerIds, members)}>{peopleInitials(task.ownerIds, members)}</span>
        {task.due ? (
          <span className={late ? "late" : undefined}>{late ? `Overdue · ${formatDay(task.due)}` : formatDay(task.due)}</span>
        ) : (
          task.status !== "done" && <span>No date</span>
        )}
        {documentCounts[task.id] ? (
          <span title="Has Documents">
            <Paperclip />
            <span className="sr-only">Has Documents</span>
          </span>
        ) : null}
      </div>
    </button>
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
          <button className="button">Move to Blocked</button>
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Paperclip() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7.5" />
    </svg>
  );
}
