"use client";

import { useState, useTransition } from "react";
import * as actions from "@/app/actions";
import { DEPARTMENTS, type Area } from "@/board/model";

export function AreasManager({
  companyId,
  areas,
  openCounts,
  removed,
}: {
  companyId: string;
  areas: Area[];
  openCounts: Record<string, number>;
  removed: { id: string; title: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => ReturnType<typeof actions.createArea>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.message);
    });

  return (
    <>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">An Area is a slice of one Department in this company. Tasks can also sit under a whole Department.</p>
      {DEPARTMENTS.map((d) => {
        const own = areas.filter((a) => a.departmentId === d.id);
        return (
          <section key={d.id}>
            <h2>{d.name}</h2>
            <ul className="list">
              {own.map((a) => (
                <AreaRow key={a.id} area={a} open={openCounts[a.id] ?? 0} siblings={areas.filter((x) => x.id !== a.id)} run={run} pending={pending} />
              ))}
            </ul>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = String(new FormData(form).get("name"));
                run(() => actions.createArea({ companyId, departmentId: d.id, name }));
                form.reset();
              }}
            >
              <input name="name" type="text" required maxLength={40} placeholder={`New Area in ${d.name}`} aria-label={`New Area in ${d.name}`} style={{ maxWidth: 320 }} />
              <button className="button secondary" disabled={pending}>
                Add Area
              </button>
            </form>
          </section>
        );
      })}

      <section>
        <h2>Removed Tasks</h2>
        {removed.length === 0 && <p className="muted">None.</p>}
        <ul className="list">
          {removed.map((t) => (
            <li key={t.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>{t.title}</span>
              <button className="button quiet" disabled={pending} onClick={() => run(() => actions.restoreTask(t.id))}>
                Restore
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">Only a Task’s Owners and Contributors can restore it.</p>
      </section>
    </>
  );
}

function AreaRow({
  area,
  open,
  siblings,
  run,
  pending,
}: {
  area: Area;
  open: number;
  siblings: Area[];
  run: (fn: () => ReturnType<typeof actions.createArea>) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<"none" | "rename" | "retire">("none");
  return (
    <li>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          {area.name} <span className="muted small">{open ? `· ${open} open` : ""}</span>
        </span>
        <span>
          <button className="button quiet" onClick={() => setMode(mode === "rename" ? "none" : "rename")}>
            Rename
          </button>
          <button className="button quiet" onClick={() => setMode(mode === "retire" ? "none" : "retire")}>
            Retire
          </button>
        </span>
      </div>
      {mode === "rename" && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => actions.renameArea(area.id, String(new FormData(e.currentTarget).get("name"))));
            setMode("none");
          }}
        >
          <input name="name" type="text" defaultValue={area.name} required maxLength={40} aria-label="New name" style={{ maxWidth: 320 }} />
          <button className="button secondary" disabled={pending}>
            Rename
          </button>
        </form>
      )}
      {mode === "retire" && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const to = String(new FormData(e.currentTarget).get("to"));
            run(() => actions.retireArea(area.id, to || null));
            setMode("none");
          }}
        >
          <label htmlFor={`to-${area.id}`} style={{ margin: 0 }}>
            Move its Tasks to
          </label>
          <select id={`to-${area.id}`} name="to" style={{ maxWidth: 320 }}>
            <option value="">The whole Department</option>
            {siblings.map((s) => (
              <option key={s.id} value={s.id}>
                {DEPARTMENTS.find((d) => d.id === s.departmentId)?.name} › {s.name}
              </option>
            ))}
          </select>
          <button className="button danger" disabled={pending}>
            Retire Area
          </button>
        </form>
      )}
    </li>
  );
}
