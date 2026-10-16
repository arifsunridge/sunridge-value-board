"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import * as actions from "@/app/actions";
import type { ProjectView } from "@/board/board";
import { DEPARTMENTS, PHASES, PHASE_LABELS, departmentName, type Area, type Person, type Phase, type Project } from "@/board/model";

type Result = Awaited<ReturnType<typeof actions.createProject>>;

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) then?.();
      else setError(r.message);
    });
  return { error, pending, run };
}

function ErrorBanner({ message }: { message: string | null }) {
  return message ? (
    <p className="banner error" role="alert">
      {message}
    </p>
  ) : null;
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const share = total ? Math.round((done / total) * 100) : 0;
  return (
    <>
      <span className="pbar" aria-hidden="true">
        <i style={{ width: `${share}%` }} />
      </span>
      <span className="small muted">{total ? `${done} of ${total} Tasks done` : "No Tasks yet"}</span>
    </>
  );
}

export function ProjectList({ companyId, projects, areas, members }: { companyId: string; projects: ProjectView[]; areas: Area[]; members: Person[] }) {
  if (!projects.length) return <p className="muted">No Projects yet.</p>;
  return (
    <ul className="projects">
      {projects.map(({ project: p, progress }) => {
        const area = areas.find((a) => a.id === p.areaId);
        const owner = p.ownerId ? (members.find((m) => m.id === p.ownerId)?.name ?? "Former member") : p.ownerName;
        return (
          <li key={p.id}>
            <div>
              <Link href={`/c/${companyId}/projects/${p.id}`}>
                <b>{p.name}</b>
              </Link>
              <span className="goal">
                {departmentName(p.departmentId)}
                {area ? ` › ${area.name}` : ""}
                {owner ? ` · ${owner}` : ""}
              </span>
              {p.goal && <span className="goal">{p.goal}</span>}
            </div>
            <div>
              <ProgressBar done={progress.done} total={progress.total} />
            </div>
            <div>{p.phase && <span className={`phase ${p.phase}`}>{PHASE_LABELS[p.phase]}</span>}</div>
          </li>
        );
      })}
    </ul>
  );
}

function HomeSelect({ areas, value, onChange }: { areas: Area[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id="project-home" value={value} onChange={(e) => onChange(e.target.value)}>
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

function parseHome(value: string, areas: Area[]): { departmentId: string; areaId: string | null } {
  if (value.startsWith("area:")) {
    const area = areas.find((a) => a.id === value.slice(5));
    return { departmentId: area?.departmentId ?? "strategy", areaId: area?.id ?? null };
  }
  return { departmentId: value.slice(5), areaId: null };
}

interface Fields {
  name: string;
  goal: string;
  owner: string;
  phase: Phase | "";
  repository: string;
  portalApp: string;
  liveUrl: string;
}

/** The Owner is a Sunridge person picked from the list, or a name typed for anyone else. */
function ProjectFields({ value, onChange, members }: { value: Fields; onChange: (v: Fields) => void; members: Person[] }) {
  const set = (key: keyof Fields) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <>
      <div className="field">
        <label htmlFor="project-name">Name</label>
        <input id="project-name" type="text" maxLength={80} required value={value.name} onChange={set("name")} />
      </div>
      <div className="field">
        <label htmlFor="project-goal">Goal</label>
        <textarea id="project-goal" rows={2} maxLength={300} value={value.goal} onChange={set("goal")} />
      </div>
      <div className="field">
        <label htmlFor="project-owner">Owner</label>
        <input id="project-owner" type="text" list="project-people" maxLength={80} value={value.owner} onChange={set("owner")} />
        <datalist id="project-people">
          {members.map((m) => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
        <div className="hint">Choose someone at Sunridge, or type a name.</div>
      </div>
      <div className="field">
        <label htmlFor="project-phase">Phase</label>
        <select id="project-phase" value={value.phase} onChange={set("phase")}>
          <option value="">Not set</option>
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {PHASE_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      <details>
        <summary>For a Project that builds an app</summary>
        <div className="field">
          <label htmlFor="project-repo">Repository</label>
          <input id="project-repo" type="text" placeholder="owner/name" value={value.repository} onChange={set("repository")} />
        </div>
        <div className="field">
          <label htmlFor="project-portal">Portal app</label>
          <input id="project-portal" type="text" placeholder="site-flow" value={value.portalApp} onChange={set("portalApp")} />
        </div>
        <div className="field">
          <label htmlFor="project-live">Live address</label>
          <input id="project-live" type="url" placeholder="https://" value={value.liveUrl} onChange={set("liveUrl")} />
        </div>
      </details>
    </>
  );
}

function toChanges(f: Fields, members: Person[]) {
  const person = members.find((m) => m.name.toLowerCase() === f.owner.trim().toLowerCase());
  return {
    name: f.name,
    goal: f.goal,
    ownerId: person?.id ?? null,
    ownerName: person ? "" : f.owner,
    phase: f.phase || null,
    repository: f.repository,
    portalApp: f.portalApp,
    liveUrl: f.liveUrl,
  };
}

const EMPTY: Fields = { name: "", goal: "", owner: "", phase: "", repository: "", portalApp: "", liveUrl: "" };

export function NewProjectForm({ companyId, areas, members }: { companyId: string; areas: Area[]; members: Person[] }) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [home, setHome] = useState(`dept:${DEPARTMENTS[0].id}`);
  const { error, pending, run } = useRun();
  return (
    <details>
      <summary>Add a Project</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => actions.createProject({ companyId, ...parseHome(home, areas), ...toChanges(fields, members) }), () => setFields(EMPTY));
        }}
      >
        <ErrorBanner message={error} />
        <ProjectFields value={fields} onChange={setFields} members={members} />
        <div className="field">
          <label htmlFor="project-home">Where it lives</label>
          <HomeSelect areas={areas} value={home} onChange={setHome} />
        </div>
        <button className="button" disabled={pending}>
          Add Project
        </button>
      </form>
    </details>
  );
}

export function ProjectEditor({ project, areas, members }: { project: Project; areas: Area[]; members: Person[] }) {
  const owner = project.ownerId ? (members.find((m) => m.id === project.ownerId)?.name ?? "") : project.ownerName;
  const [fields, setFields] = useState<Fields>({
    name: project.name,
    goal: project.goal,
    owner,
    phase: project.phase ?? "",
    repository: project.repository,
    portalApp: project.portalApp,
    liveUrl: project.liveUrl,
  });
  const current = project.areaId ? `area:${project.areaId}` : `dept:${project.departmentId}`;
  const [home, setHome] = useState(current);
  const { error, pending, run } = useRun();
  return (
    <>
      <ErrorBanner message={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (home !== current) {
              const moved = await actions.moveProject(project.id, parseHome(home, areas));
              if (!moved.ok) return moved;
            }
            return actions.updateProject(project.id, toChanges(fields, members));
          });
        }}
      >
        <ProjectFields value={fields} onChange={setFields} members={members} />
        <div className="field">
          <label htmlFor="project-home">Where it lives</label>
          <HomeSelect areas={areas} value={home} onChange={setHome} />
          <div className="hint">Moving a Project moves its Tasks with it.</div>
        </div>
        <div className="row">
          <button className="button" disabled={pending}>
            Save changes
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => run(() => (project.removed ? actions.restoreProject(project.id) : actions.removeProject(project.id)))}
          >
            {project.removed ? "Restore this Project" : "Remove this Project"}
          </button>
        </div>
      </form>
    </>
  );
}

export function UpdateForm({ projectId }: { projectId: string }) {
  const [text, setText] = useState("");
  const { error, pending, run } = useRun();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => actions.addProjectUpdate(projectId, text), () => setText(""));
      }}
    >
      <ErrorBanner message={error} />
      <div className="field">
        <label htmlFor="update">Add an Update</label>
        <textarea id="update" rows={2} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} />
        <div className="hint">A dated line of news. Updates can&apos;t be changed later.</div>
      </div>
      <button className="button secondary" disabled={pending}>
        Add Update
      </button>
    </form>
  );
}
