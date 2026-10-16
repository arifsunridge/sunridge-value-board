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
  OWNER_NAMES_MAX,
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_RULE,
  STATUSES,
  STATUS_LABELS,
  TITLE_MAX_WORDS,
  canBeShared,
  departmentName,
  type Area,
  type Company,
  type Document,
  type DocumentStatus,
  type Person,
  type Priority,
  type Project,
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
  /** The Projects in this Company the asker can see. */
  projects: Project[];
  members: Person[];
  meId: string;
  /** Members keep everything; the Company team changes only a few fields of their own Shared Tasks (ADR 0005). */
  isCompanyTeam: boolean;
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

/** Members, plus this company's team when the Task is Shared. */
function eligible(members: Person[], companyId: string, shared: boolean): Person[] {
  return members.filter((p) => p.kind === "member" || (shared && p.companyId === companyId));
}

function PrivateField({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        Private
      </label>
      <div className="hint">Only its Owners and Contributors see it, not the rest of Sunridge. Keep yourself on it.</div>
    </div>
  );
}

function SharedField({ company, departmentId, value, onChange }: { company: Company; departmentId: string; value: boolean; onChange: (v: boolean) => void }) {
  if (company.kind !== "portfolio") return null;
  const allowed = canBeShared(departmentId as Parameters<typeof canBeShared>[0]);
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={value && allowed} disabled={!allowed} onChange={(e) => onChange(e.target.checked)} />
        Share with the {company.name} team
      </label>
      <div className="hint">
        {allowed
          ? `The ${company.name} team in the portal will see this Task, and can own or help on it.`
          : "Talent & organisation and Finance are never shared."}
      </div>
    </div>
  );
}

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
  members: Person[];
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

/** Owners who aren't on the board, typed by name and separated by commas (ADR 0009). */
function OwnerNamesField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="field">
      <label htmlFor="ownerNames">Other Owners, by name</label>
      <input id="ownerNames" type="text" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      <div className="hint">For people who aren&apos;t on the board yet. Separate names with commas; up to {OWNER_NAMES_MAX}.</div>
    </div>
  );
}

const splitNames = (value: string) =>
  value
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

function CompanyOwnerField({ company, value, onChange, disabled }: { company: Company; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  if (company.kind !== "portfolio") return null;
  return (
    <div className="field">
      <label htmlFor="companyOwner">{company.name} owner</label>
      <input id="companyOwner" type="text" maxLength={120} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      <div className="hint">Who answers for this at {company.name}, by name. It gives them no access to the board.</div>
    </div>
  );
}

function ProjectField({ projects, value, onChange, disabled }: { projects: Project[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  if (!projects.length) return null;
  return (
    <div className="field">
      <label htmlFor="project">Project</label>
      <select id="project" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">None</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="hint">A Task in a Project lives where the Project lives.</div>
    </div>
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

function NewTaskForm({ company, areas, projects, members, meId, onDone }: Props & { onDone: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [home, setHome] = useState(`dept:${DEPARTMENTS[0].id}`);
  const [owners, setOwners] = useState([meId]);
  const [ownerNames, setOwnerNames] = useState("");
  const [companyOwner, setCompanyOwner] = useState("");
  const [projectId, setProjectId] = useState("");
  const [contributors, setContributors] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(false);
  const [isPrivate, setPrivate] = useState(false);
  const { error, pending, run } = useAction();
  const { departmentId } = parseHome(home, areas);
  // A Private Task is never Shared (ADR 0010).
  const isShared = !isPrivate && shared && company.kind === "portfolio" && canBeShared(departmentId as Parameters<typeof canBeShared>[0]);
  const people = eligible(members, company.id, isShared);
  const keep = (ids: string[]) => ids.filter((id) => people.some((p) => p.id === id));

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
              ownerIds: keep(owners),
              ownerNames: splitNames(ownerNames),
              companyOwner,
              projectId: projectId || null,
              contributorIds: keep(contributors),
              due: due || null,
              note,
              shared: isShared,
              private: isPrivate,
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
      <ProjectField projects={projects} value={projectId} onChange={setProjectId} />
      <PrivateField value={isPrivate} onChange={setPrivate} />
      {!isPrivate && <SharedField company={company} departmentId={departmentId} value={shared} onChange={setShared} />}
      <PeopleField label="Owners" members={people} value={keep(owners)} onChange={setOwners} />
      <OwnerNamesField value={ownerNames} onChange={setOwnerNames} />
      <CompanyOwnerField company={company} value={companyOwner} onChange={setCompanyOwner} />
      <details>
        <summary>Contributors, due date and note</summary>
        <PeopleField label="Contributors" members={people} value={keep(contributors)} onChange={setContributors} exclude={owners} />
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
  const { data, members, areas, companies, company, isCompanyTeam, projects } = props;
  const { task } = data;
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState(task.priority);
  const [owners, setOwners] = useState(task.ownerIds);
  const [ownerNames, setOwnerNames] = useState(task.ownerNames.join(", "));
  const [companyOwner, setCompanyOwner] = useState(task.companyOwner);
  const [projectId, setProjectId] = useState(task.projectId ?? "");
  const [contributors, setContributors] = useState(task.contributorIds);
  const [due, setDue] = useState(task.due ?? "");
  const [note, setNote] = useState(task.note);
  const [status, setStatus] = useState<Status>(task.status);
  const [home, setHome] = useState(homeValue(task.departmentId, task.areaId));
  const [waitingOn, setWaitingOn] = useState("");
  const save = useAction();
  const move = useAction();
  const join = useAction();
  const share = useAction();
  const lock = useAction();
  const disabled = !data.canEdit;
  // The Company team may change the title, due date, note and Status of their own Tasks; the rest stays with Sunridge.
  const sunridgeOnly = disabled || isCompanyTeam;
  const people = eligible(members, task.companyId, task.shared);
  const names = Object.fromEntries([
    ...companies.map((c) => [c.id, c.name]),
    ...data.allAreas.map((a) => [a.id, a.name]),
    ...projects.map((p) => [p.id, p.name]),
  ]);

  const changes = {
    ...(title !== task.title && { title }),
    ...(priority !== task.priority && { priority }),
    ...(owners.join() !== task.ownerIds.join() && { ownerIds: owners }),
    ...(splitNames(ownerNames).join() !== task.ownerNames.join() && { ownerNames: splitNames(ownerNames) }),
    ...(companyOwner.trim() !== task.companyOwner && { companyOwner }),
    ...((projectId || null) !== task.projectId && { projectId: projectId || null }),
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
          You’re viewing this Task. Only its Owners and Contributors can change it, or any Sunridge Member while none of its Owners has signed in.
          {!isCompanyTeam && (
            <div style={{ marginTop: 8 }}>
              <button className="button secondary" disabled={join.pending} onClick={() => join.run(() => actions.joinTask(task.id))}>
                Join as a Contributor
              </button>
            </div>
          )}
          <ErrorBanner message={join.error} />
        </div>
      )}
      {isCompanyTeam && !disabled && (
        <p className="banner">Sunridge shared this Task with you. You can change its title, Status, due date and note, and add links.</p>
      )}
      {!isCompanyTeam && (
        <div className="banner shared-state">
          {task.private
            ? "Private: only its Owners and Contributors see this Task."
            : "Every Sunridge Member can see this Task. Make it private to keep it to its Owners and Contributors."}
          {!disabled && !task.shared && (
            <div style={{ marginTop: 8 }}>
              <button
                className="button secondary"
                disabled={lock.pending}
                onClick={() => lock.run(() => actions.setPrivate(task.id, !task.private))}
              >
                {task.private ? "Open to Sunridge" : "Make private"}
              </button>
            </div>
          )}
          {!disabled && task.shared && <div className="hint">Stop sharing it to make it private.</div>}
          <ErrorBanner message={lock.error} />
        </div>
      )}
      {!isCompanyTeam && company.kind === "portfolio" && !task.private && (
        <div className="banner shared-state">
          {task.shared ? `Shared with the ${company.name} team.` : `Not shared: only Sunridge sees this Task.`}
          {!disabled && (canBeShared(task.departmentId) || task.shared) && (
            <div style={{ marginTop: 8 }}>
              <button
                className="button secondary"
                disabled={share.pending}
                onClick={() => share.run(() => actions.shareTask(task.id, !task.shared))}
              >
                {task.shared ? "Stop sharing" : `Share with the ${company.name} team`}
              </button>
              {task.shared && <div className="hint">Stopping takes the {company.name} team off this Task.</div>}
            </div>
          )}
          <ErrorBanner message={share.error} />
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
        <PriorityField value={priority} onChange={setPriority} disabled={sunridgeOnly} />
        <PeopleField label="Owners" members={people} value={owners} onChange={setOwners} disabled={sunridgeOnly} />
        <OwnerNamesField value={ownerNames} onChange={setOwnerNames} disabled={sunridgeOnly} />
        <CompanyOwnerField company={company} value={companyOwner} onChange={setCompanyOwner} disabled={sunridgeOnly} />
        <ProjectField projects={projects} value={projectId} onChange={setProjectId} disabled={sunridgeOnly} />
        <div className="field">
          <label htmlFor="due">Due</label>
          <input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={disabled} />
        </div>
        <NoteField value={note} onChange={setNote} disabled={disabled} label={task.status === "blocked" ? "Waiting on" : "Note"} />
        <details>
          <summary>Contributors</summary>
          <PeopleField label="Contributors" members={people} value={contributors} onChange={setContributors} exclude={owners} disabled={sunridgeOnly} />
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
            move.run(() => actions.moveTask(task.id, isCompanyTeam ? { status, waitingOn } : { status, ...parseHome(home, areas), waitingOn }));
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
            {isCompanyTeam ? (
              <input id="home" type="text" value={`${departmentName(task.departmentId)}${task.areaId ? ` › ${areas.find((a) => a.id === task.areaId)?.name ?? ""}` : ""}`} disabled />
            ) : (
              <HomeSelect id="home" areas={areas} value={home} onChange={setHome} />
            )}
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
        {!disabled && <AddDocument taskId={task.id} linksOnly={isCompanyTeam} />}
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

      {!disabled && !isCompanyTeam && <MoreActions {...props} />}
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
      {mode === "replace" && (
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
      )}
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

/** Files stay in SharePoint (ADR 0006): add the SharePoint link to the file. */
function AddDocument({ taskId, linksOnly }: { taskId: string; linksOnly: boolean }) {
  const [kind, setKind] = useState<"link" | "claude">("link");
  const act = useAction();
  const [formKey, setFormKey] = useState(0);
  return (
    <details>
      <summary className="small">Add a Document</summary>
      <div className="field">
        <label htmlFor="docKind">Kind</label>
        <select id="docKind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="link">SharePoint or web link</option>
          {!linksOnly && <option value="claude">Claude work (link)</option>}
        </select>
      </div>
      {
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
      }
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
