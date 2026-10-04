"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import * as actions from "@/app/actions";
import {
  DEPARTMENTS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  NOTE_MAX_CHARS,
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_RULE,
  STATUSES,
  STATUS_LABELS,
  TITLE_MAX_WORDS,
  departmentName,
  type Area,
  type Company,
  type Document,
  type DocumentStatus,
  type Member,
  type Priority,
  type Status,
  type Task,
  type TrailEntry,
} from "@/board/model";
import { titleHints, words } from "@/board/rules";
import { describe, formatWhen } from "./format";

export type PanelData =
  | { mode: "new" }
  | {
      mode: "edit";
      task: Task;
      documents: Document[];
      trail: TrailEntry[];
      canEdit: boolean;
      allAreas: Area[];
      moveTargets: { id: string; title: string }[];
    };

interface Props {
  data: PanelData;
  company: Company;
  companies: Company[];
  areas: Area[];
  members: Member[];
  meId: string;
}

type Result = Awaited<ReturnType<typeof actions.updateTask>>;

/** Runs a server action, showing its plain-English error if a rule is broken. */
function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, then?: (r: Extract<Result, { ok: true }>) => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) then?.(result);
      else setError(result.message);
    });
  };
  return { error, pending, run };
}

export function TaskPanel(props: Props) {
  const router = useRouter();
  const close = () => router.push("?", { scroll: false });
  const title = props.data.mode === "new" ? "Add task" : props.data.task.title;
  return (
    <>
      <div className="panel-backdrop" onClick={close} />
      <aside className="panel" aria-label={title}>
        <div className="panel-head">
          <h2>{props.data.mode === "new" ? "Add task" : "Task"}</h2>
          <button className="button quiet" onClick={close}>
            Close
          </button>
        </div>
        {props.data.mode === "new" ? (
          <NewTaskForm {...props} onDone={(id) => router.replace(`?task=${id}`, { scroll: false })} />
        ) : (
          <EditTask key={props.data.task.updatedAt} {...props} data={props.data} />
        )}
      </aside>
    </>
  );
}

// ---------- shared fields ----------

function homeValue(departmentId: string, areaId: string | null) {
  return areaId ? `area:${areaId}` : `dept:${departmentId}`;
}

function parseHome(value: string, areas: Area[]): { departmentId: string; areaId: string | null } {
  if (value.startsWith("area:")) {
    const area = areas.find((a) => a.id === value.slice(5));
    return { departmentId: area?.departmentId ?? "strategy", areaId: area?.id ?? null };
  }
  return { departmentId: value.slice(5), areaId: null };
}

function HomeSelect({ id, areas, value, onChange }: { id: string; areas: Area[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {DEPARTMENTS.map((d) => (
        <optgroup key={d.id} label={d.name}>
          <option value={`dept:${d.id}`}>{d.name}: whole department</option>
          {areas
            .filter((a) => a.departmentId === d.id && !a.retired)
            .map((a) => (
              <option key={a.id} value={`area:${a.id}`}>
                {d.name} › {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

function TitleField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const count = words(value).length;
  const hints = titleHints(value);
  return (
    <div className="field">
      <label htmlFor="title">Title</label>
      <input id="title" type="text" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required />
      <div className={`hint${count > TITLE_MAX_WORDS ? " warn" : ""}`}>
        {count} of {TITLE_MAX_WORDS} words
        {hints.map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>
    </div>
  );
}

function PriorityField({ value, onChange, disabled }: { value: Priority; onChange: (v: Priority) => void; disabled?: boolean }) {
  return (
    <fieldset className="field">
      <legend className="small muted" style={{ marginBottom: 4 }}>
        Priority
      </legend>
      <div className="priority-choice">
        {PRIORITIES.map((p) => (
          <label key={p} className={`priority-${p}`}>
            <input type="radio" name="priority" value={p} checked={value === p} onChange={() => onChange(p)} disabled={disabled} />
            <span className="swatch" aria-hidden="true" />
            {PRIORITY_LABELS[p]}
          </label>
        ))}
      </div>
      <div className="hint">{PRIORITY_RULE[value]}</div>
    </fieldset>
  );
}

function PeopleField({
  label,
  members,
  value,
  onChange,
  exclude = [],
  disabled,
}: {
  label: string;
  members: Member[];
  value: string[];
  onChange: (v: string[]) => void;
  exclude?: string[];
  disabled?: boolean;
}) {
  return (
    <fieldset className="field">
      <legend className="small muted" style={{ marginBottom: 4 }}>
        {label}
      </legend>
      <div className="people">
        {members
          .filter((m) => !exclude.includes(m.id))
          .map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={value.includes(m.id)}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked ? [...value, m.id] : value.filter((id) => id !== m.id))}
              />
              {m.name}
            </label>
          ))}
      </div>
    </fieldset>
  );
}

function NoteField({ value, onChange, label = "Note", disabled }: { value: string; onChange: (v: string) => void; label?: string; disabled?: boolean }) {
  return (
    <div className="field">
      <label htmlFor="note">{label}</label>
      <textarea id="note" rows={2} maxLength={NOTE_MAX_CHARS} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      <div className="hint">Two lines at most.</div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  return message ? (
    <p className="banner error" role="alert">
      {message}
    </p>
  ) : null;
}

// ---------- new ----------

function NewTaskForm({ company, areas, members, meId, onDone }: Props & { onDone: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [home, setHome] = useState(`dept:${DEPARTMENTS[0].id}`);
  const [owners, setOwners] = useState([meId]);
  const [contributors, setContributors] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            actions.createTask({
              companyId: company.id,
              ...parseHome(home, areas),
              title,
              priority,
              ownerIds: owners,
              contributorIds: contributors,
              due: due || null,
              note,
            }),
          (r) => r.id && onDone(r.id),
        );
      }}
    >
      <ErrorBanner message={error} />
      <TitleField value={title} onChange={setTitle} />
      <PriorityField value={priority} onChange={setPriority} />
      <div className="field">
        <label htmlFor="home">Where it lives</label>
        <HomeSelect id="home" areas={areas} value={home} onChange={setHome} />
      </div>
      <PeopleField label="Owners" members={members} value={owners} onChange={setOwners} />
      <details>
        <summary>Contributors, due date and note</summary>
        <PeopleField label="Contributors" members={members} value={contributors} onChange={setContributors} exclude={owners} />
        <div className="field">
          <label htmlFor="due">Due</label>
          <input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <NoteField value={note} onChange={setNote} />
      </details>
      <button className="button" disabled={pending}>
        Add task to {company.name}
      </button>
    </form>
  );
}

// ---------- edit ----------

function EditTask(props: Props & { data: Extract<PanelData, { mode: "edit" }> }) {
  const { data, members, areas, companies } = props;
  const { task } = data;
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState(task.priority);
  const [owners, setOwners] = useState(task.ownerIds);
  const [contributors, setContributors] = useState(task.contributorIds);
  const [due, setDue] = useState(task.due ?? "");
  const [note, setNote] = useState(task.note);
  const [status, setStatus] = useState<Status>(task.status);
  const [home, setHome] = useState(homeValue(task.departmentId, task.areaId));
  const [waitingOn, setWaitingOn] = useState("");
  const save = useAction();
  const move = useAction();
  const join = useAction();
  const disabled = !data.canEdit;
  const names = Object.fromEntries([...companies.map((c) => [c.id, c.name]), ...data.allAreas.map((a) => [a.id, a.name])]);

  const changes = {
    ...(title !== task.title && { title }),
    ...(priority !== task.priority && { priority }),
    ...(owners.join() !== task.ownerIds.join() && { ownerIds: owners }),
    ...(contributors.join() !== task.contributorIds.join() && { contributorIds: contributors }),
    ...((due || null) !== task.due && { due: due || null }),
    ...(note !== task.note && { note }),
  };
  const dirty = Object.keys(changes).length > 0;
  const moved = status !== task.status || home !== homeValue(task.departmentId, task.areaId);
  const removedDocs = data.documents.filter((d) => d.removed);
  const docs = data.documents.filter((d) => !d.removed);

  return (
    <>
      {disabled && (
        <div className="banner">
          You’re viewing this Task. Only its Owners and Contributors can change it.
          <div style={{ marginTop: 8 }}>
            <button className="button secondary" disabled={join.pending} onClick={() => join.run(() => actions.joinTask(task.id))}>
              Join as a Contributor
            </button>
          </div>
          <ErrorBanner message={join.error} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(() => actions.updateTask(task.id, changes));
        }}
      >
        <ErrorBanner message={save.error} />
        <TitleField value={title} onChange={setTitle} disabled={disabled} />
        <PriorityField value={priority} onChange={setPriority} disabled={disabled} />
        <PeopleField label="Owners" members={members} value={owners} onChange={setOwners} disabled={disabled} />
        <div className="field">
          <label htmlFor="due">Due</label>
          <input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={disabled} />
        </div>
        <NoteField value={note} onChange={setNote} disabled={disabled} label={task.status === "blocked" ? "Waiting on" : "Note"} />
        <details>
          <summary>Contributors</summary>
          <PeopleField label="Contributors" members={members} value={contributors} onChange={setContributors} exclude={owners} disabled={disabled} />
        </details>
        {!disabled && (
          <button className="button" disabled={!dirty || save.pending}>
            Save changes
          </button>
        )}
      </form>

      <details open={moved}>
        <summary>
          {STATUS_LABELS[task.status]} · {departmentName(task.departmentId)}
          {task.areaId ? ` › ${areas.find((a) => a.id === task.areaId)?.name ?? ""}` : ""}
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            move.run(() => actions.moveTask(task.id, { status, ...parseHome(home, areas), waitingOn }));
          }}
        >
          <ErrorBanner message={move.error} />
          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value as Status)} disabled={disabled}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          {status === "blocked" && task.status !== "blocked" && (
            <div className="field">
              <label htmlFor="waitingOn">Waiting on?</label>
              <input id="waitingOn" type="text" maxLength={200} value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="home">Where it lives</label>
            <HomeSelect id="home" areas={areas} value={home} onChange={setHome} />
          </div>
          {!disabled && (
            <button className="button" disabled={!moved || move.pending}>
              Move
            </button>
          )}
        </form>
      </details>

      <details open={docs.length > 0}>
        <summary>Documents</summary>
        {docs.length === 0 && <p className="muted small">No Documents yet.</p>}
        {docs.map((d) => (
          <DocumentRow key={d.id} doc={d} disabled={disabled} moveTargets={data.moveTargets} />
        ))}
        {!disabled && <AddDocument taskId={task.id} />}
        {removedDocs.length > 0 && (
          <details>
            <summary className="small">Removed Documents</summary>
            {removedDocs.map((d) => (
              <RemovedDocument key={d.id} doc={d} disabled={disabled} />
            ))}
          </details>
        )}
      </details>

      <details>
        <summary>Trail</summary>
        <ul className="trail">
          {[...data.trail].reverse().map((e) => (
            <li key={e.id}>
              <span className="muted">{formatWhen(e.at)}</span> · {describe(e, members, names)}
            </li>
          ))}
        </ul>
      </details>

      {!disabled && <MoreActions {...props} />}
    </>
  );
}

function DocumentRow({ doc, disabled, moveTargets }: { doc: Document; disabled: boolean; moveTargets: { id: string; title: string }[] }) {
  const act = useAction();
  const [mode, setMode] = useState<"none" | "replace" | "move">("none");
  return (
    <div className="doc">
      <div className="row">
        <a href={doc.url} target="_blank" rel="noopener noreferrer">
          {doc.name}
        </a>
        <span className="muted small">{DOCUMENT_KIND_LABELS[doc.kind]}</span>
      </div>
      <ErrorBanner message={act.error} />
      <div className="row small" style={{ marginTop: 4 }}>
        <select
          aria-label="Document status"
          value={doc.status}
          disabled={disabled || act.pending}
          onChange={(e) => act.run(() => actions.updateDocument(doc.id, { status: e.target.value as DocumentStatus }))}
          style={{ width: "auto" }}
        >
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DOCUMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {!disabled && (
          <>
            <button className="button quiet" onClick={() => setMode(mode === "replace" ? "none" : "replace")}>
              Replace
            </button>
            <button className="button quiet" onClick={() => setMode(mode === "move" ? "none" : "move")}>
              Move
            </button>
            <button className="button quiet" onClick={() => act.run(() => actions.removeDocument(doc.id))}>
              Remove
            </button>
          </>
        )}
      </div>
      {mode === "replace" &&
        (doc.kind === "file" ? (
          <UploadForm label="Upload a new version" fields={{ documentId: doc.id }} onDone={() => setMode("none")} />
        ) : (
          <form
            className="row"
            style={{ marginTop: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              const url = String(new FormData(e.currentTarget).get("url"));
              act.run(() => actions.replaceLink(doc.id, url), () => setMode("none"));
            }}
          >
            <input name="url" type="url" required placeholder="https://" aria-label="New link" style={{ flex: 1 }} />
            <button className="button secondary">Replace</button>
          </form>
        ))}
      {mode === "move" && (
        <form
          className="row"
          style={{ marginTop: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            const to = String(new FormData(e.currentTarget).get("to"));
            act.run(() => actions.moveDocument(doc.id, to), () => setMode("none"));
          }}
        >
          <select name="to" aria-label="Move to Task" style={{ flex: 1 }} required>
            {moveTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <button className="button secondary" disabled={!moveTargets.length}>
            Move
          </button>
        </form>
      )}
    </div>
  );
}

function RemovedDocument({ doc, disabled }: { doc: Document; disabled: boolean }) {
  const act = useAction();
  return (
    <div className="doc row small">
      <span className="muted">{doc.name}</span>
      {!disabled && (
        <button className="button quiet" disabled={act.pending} onClick={() => act.run(() => actions.restoreDocument(doc.id))}>
          Restore
        </button>
      )}
      <ErrorBanner message={act.error} />
    </div>
  );
}

function AddDocument({ taskId }: { taskId: string }) {
  const [kind, setKind] = useState<"link" | "claude" | "file">("link");
  const act = useAction();
  const [formKey, setFormKey] = useState(0);
  return (
    <details>
      <summary className="small">Add a Document</summary>
      <div className="field">
        <label htmlFor="docKind">Kind</label>
        <select id="docKind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="link">SharePoint or web link</option>
          <option value="claude">Claude work (link)</option>
          <option value="file">File (saved to SharePoint)</option>
        </select>
      </div>
      {kind === "file" ? (
        <UploadForm label="Upload" fields={{ taskId }} />
      ) : (
        <form
          key={formKey}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act.run(
              () =>
                actions.addLink(taskId, {
                  kind,
                  name: String(f.get("name")),
                  url: String(f.get("url")),
                  status: String(f.get("status")) as DocumentStatus,
                }),
              () => setFormKey(formKey + 1),
            );
          }}
        >
          <ErrorBanner message={act.error} />
          <div className="field">
            <label htmlFor="docName">Name</label>
            <input id="docName" name="name" type="text" required maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="docUrl">Link</label>
            <input id="docUrl" name="url" type="url" required placeholder="https://" />
          </div>
          <StatusSelect />
          <button className="button secondary" disabled={act.pending}>
            Add
          </button>
        </form>
      )}
    </details>
  );
}

function StatusSelect() {
  return (
    <div className="field">
      <label htmlFor="docStatus">Status</label>
      <select id="docStatus" name="status" defaultValue="draft">
        {DOCUMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {DOCUMENT_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Files go straight to SharePoint through the upload route; the app keeps only the link. */
function UploadForm({ label, fields, onDone }: { label: string; fields: Record<string, string>; onDone?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      style={{ marginTop: 6 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const form = new FormData(e.currentTarget);
        Object.entries(fields).forEach(([k, v]) => form.set(k, v));
        const response = await fetch("/api/documents/upload", { method: "POST", body: form });
        setPending(false);
        if (!response.ok) {
          setError(((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? "The upload didn't work.");
          return;
        }
        onDone?.();
        router.refresh();
      }}
    >
      <ErrorBanner message={error} />
      <div className="field">
        <label htmlFor="file">File</label>
        <input id="file" name="file" type="file" required />
      </div>
      {!fields.documentId && <StatusSelect />}
      <button className="button secondary" disabled={pending}>
        {pending ? "Uploading…" : label}
      </button>
    </form>
  );
}

function MoreActions({ data, companies, company }: Props & { data: Extract<PanelData, { mode: "edit" }> }) {
  const router = useRouter();
  const act = useAction();
  const others = companies.filter((c) => c.id !== company.id);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [home, setHome] = useState(`dept:${data.task.departmentId}`);
  const targetAreas = data.allAreas.filter((a) => a.companyId === to);
  return (
    <details>
      <summary>More</summary>
      <ErrorBanner message={act.error} />
      {others.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act.run(
              () => actions.changeCompany(data.task.id, { companyId: to, ...parseHome(home, targetAreas) }),
              () => router.push(`/c/${to}?task=${data.task.id}`),
            );
          }}
        >
          <div className="field">
            <label htmlFor="toCompany">Move to another company</label>
            <select id="toCompany" value={to} onChange={(e) => setTo(e.target.value)}>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="toHome">Where it lives there</label>
            <HomeSelect id="toHome" areas={targetAreas} value={home} onChange={setHome} />
          </div>
          <button className="button secondary" disabled={act.pending}>
            Move to {others.find((c) => c.id === to)?.name}
          </button>
        </form>
      )}
      <p style={{ marginTop: 16 }}>
        <button
          className="button danger"
          disabled={act.pending}
          onClick={() => act.run(() => actions.removeTask(data.task.id), () => router.push("?", { scroll: false }))}
        >
          Remove this Task
        </button>
      </p>
      <p className="hint">Removed Tasks keep their Trail and can be restored from Areas.</p>
    </details>
  );
}
