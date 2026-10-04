"use client";

import { useState, useTransition } from "react";
import { confirm, suggest } from "@/app/c/[companyId]/capture/actions";
import { DEPARTMENTS, PRIORITIES, PRIORITY_LABELS, type Area, type Company, type Member } from "@/board/model";
import { titleHints, words } from "@/board/rules";
import type { Suggestion } from "@/capture/capture";

type Row = Suggestion & { key: number; state: "open" | "saving" | "added" | "discarded"; error?: string };

export function CaptureScreen({ company, areas, members, today }: { company: Company; areas: Area[]; members: Member[]; today: string }) {
  const [notes, setNotes] = useState("");
  const [meetingDate, setMeetingDate] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const result = await suggest(company.id, meetingDate, notes);
            if (!result.ok) return setError(result.message);
            setRows(result.suggestions.map((s, i) => ({ ...s, key: Date.now() + i, state: "open" })));
          });
        }}
      >
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="meetingDate">Meeting date</label>
          <input id="meetingDate" type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="notes">Meeting notes</label>
          <textarea id="notes" rows={10} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="hint">The notes are read once to suggest Tasks and are not saved. Nothing reaches the board until you confirm it.</div>
        </div>
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={pending || !notes.trim()}>
          {pending ? "Reading the notes…" : "Suggest tasks"}
        </button>
      </form>

      {rows.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2>Suggestions</h2>
          {rows.every((r) => r.state !== "open" && r.state !== "saving") && <p className="muted">All done.</p>}
          {rows
            .filter((r) => r.state === "open" || r.state === "saving")
            .map((r) => (
              <SuggestionRow
                key={r.key}
                row={r}
                areas={areas}
                members={members}
                onChange={(patch) => update(r.key, patch)}
                onDiscard={() => update(r.key, { state: "discarded" })}
                onConfirm={() => {
                  update(r.key, { state: "saving", error: undefined });
                  start(async () => {
                    const { key: _key, state: _state, error: _error, ...s } = r;
                    const result = await confirm(company.id, meetingDate, s);
                    update(r.key, result.ok ? { state: "added" } : { state: "open", error: result.message });
                  });
                }}
              />
            ))}
          {rows.some((r) => r.state === "added") && (
            <p className="muted small">{rows.filter((r) => r.state === "added").map((r) => r.title).join(" · ")} added to the board.</p>
          )}
        </section>
      )}
    </>
  );
}

function SuggestionRow({
  row,
  areas,
  members,
  onChange,
  onConfirm,
  onDiscard,
}: {
  row: Row;
  areas: Area[];
  members: Member[];
  onChange: (patch: Partial<Row>) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const home = row.areaId ? `area:${row.areaId}` : `dept:${row.departmentId}`;
  const hints = titleHints(row.title);
  const tooLong = words(row.title).length > 8;
  return (
    <div className={`doc priority-${row.priority}`} style={{ borderLeft: "4px solid var(--p)", paddingLeft: 10, marginBottom: 12 }}>
      {row.error && (
        <p className="banner error" role="alert">
          {row.error}
        </p>
      )}
      <div className="field">
        <label>Title</label>
        <input type="text" value={row.title} onChange={(e) => onChange({ title: e.target.value })} aria-label="Title" />
        {(tooLong || hints.length > 0) && (
          <div className="hint warn">
            {tooLong && <div>Shorten to 8 words or fewer.</div>}
            {hints.map((h) => (
              <div key={h}>{h}</div>
            ))}
          </div>
        )}
      </div>
      <div className="row">
        <select aria-label="Priority" value={row.priority} onChange={(e) => onChange({ priority: e.target.value as Row["priority"] })} style={{ width: "auto" }}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          aria-label="Where it lives"
          value={home}
          style={{ width: "auto", maxWidth: "100%" }}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("area:")) {
              const a = areas.find((x) => x.id === v.slice(5));
              if (a) onChange({ areaId: a.id, departmentId: a.departmentId });
            } else onChange({ areaId: null, departmentId: v.slice(5) as Row["departmentId"] });
          }}
        >
          {DEPARTMENTS.map((d) => (
            <optgroup key={d.id} label={d.name}>
              <option value={`dept:${d.id}`}>{d.name}: whole department</option>
              {areas
                .filter((a) => a.departmentId === d.id)
                .map((a) => (
                  <option key={a.id} value={`area:${a.id}`}>
                    {d.name} › {a.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <input type="date" aria-label="Due" value={row.due ?? ""} onChange={(e) => onChange({ due: e.target.value || null })} style={{ width: "auto" }} />
      </div>
      <div className="people" style={{ margin: "8px 0" }} role="group" aria-label="Owners">
        <span className="small muted">Owners:</span>
        {members.map((m) => (
          <label key={m.id}>
            <input
              type="checkbox"
              checked={row.ownerIds.includes(m.id)}
              onChange={(e) => onChange({ ownerIds: e.target.checked ? [...row.ownerIds, m.id] : row.ownerIds.filter((id) => id !== m.id) })}
            />
            {m.name}
          </label>
        ))}
      </div>
      {!row.ownerIds.length && <div className="hint warn">Choose at least one Owner before confirming.</div>}
      {row.note && (
        <div className="field">
          <input type="text" aria-label="Note" value={row.note} maxLength={200} onChange={(e) => onChange({ note: e.target.value })} />
        </div>
      )}
      <div className="row">
        <button className="button" onClick={onConfirm} disabled={row.state === "saving" || !row.ownerIds.length || tooLong}>
          Confirm
        </button>
        <button className="button secondary" onClick={onDiscard} disabled={row.state === "saving"}>
          Discard
        </button>
      </div>
    </div>
  );
}
