"use client";

import { useState, useTransition } from "react";
import { importReview } from "@/app/import/actions";
import { PRIORITY_LABELS, STATUS_LABELS, departmentName, isDepartmentId } from "@/board/model";
import type { ImportResult } from "@/import/apply";
import type { ReviewItem } from "@/import/review";

export function ImportScreen({ people }: { people: { id: string; name: string }[] }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? `${id} (not signed in yet)`;
  const ticked = items?.filter((i) => i.approved).length ?? 0;

  async function read(file: File) {
    setError(null);
    setResult(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("not a list");
      setItems(parsed as ReviewItem[]);
    } catch {
      setItems(null);
      setError("That file isn't a review file from the import.");
    }
  }

  function toggle(index: number) {
    setItems((current) => current && current.map((item, i) => (i === index ? { ...item, approved: !item.approved } : item)));
  }

  /** A Task needs an Owner: choosing one for a Task that had none also ticks it. */
  function setOwner(index: number, id: string) {
    setItems((current) => current && current.map((item, i) => (i === index ? { ...item, ownerIds: id ? [id] : [], approved: Boolean(id) } : item)));
  }

  return (
    <>
      <div className="field">
        <label htmlFor="reviewFile">Review file</label>
        <input id="reviewFile" type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </div>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="banner" role="status">
          Imported {result.imported.length} Tasks.
          {result.notInNow.length > 0 && ` ${result.notInNow.length} came in as Next because Now was full.`}
          {result.skipped.length > 0 && (
            <ul>
              {result.skipped.map((s) => (
                <li key={s.title}>
                  {s.title}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {items && !result && (
        <>
          <div className="toolbar">
            <span className="muted">
              {ticked} of {items.length} ticked
            </span>
            <span className="spacer" />
            <button className="button" disabled={pending || ticked === 0} onClick={() => startTransition(async () => {
              const r = await importReview(items);
              if (r.ok) setResult(r.result);
              else setError(r.message);
            })}>
              {pending ? "Importing…" : `Import ${ticked} Tasks`}
            </button>
          </div>
          <table className="import-table">
            <thead>
              <tr>
                <th scope="col">Import</th>
                <th scope="col">Task</th>
                <th scope="col">Where it lives</th>
                <th scope="col">Status</th>
                <th scope="col">Owners</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.prototypeId}>
                  <td>
                    <input type="checkbox" checked={item.approved} onChange={() => toggle(i)} aria-label={`Import ${item.title}`} />
                  </td>
                  <td>
                    {item.title}
                    <div className="hint">
                      {PRIORITY_LABELS[item.priority]}
                      {item.due ? ` · due ${item.due}` : ""}
                      {item.documents?.length ? ` · ${item.documents.length} Document${item.documents.length === 1 ? "" : "s"}` : ""}
                    </div>
                  </td>
                  <td>
                    {item.company} › {isDepartmentId(item.departmentId) ? departmentName(item.departmentId) : item.departmentId}
                    {item.area ? ` › ${item.area}` : ""}
                  </td>
                  <td>{STATUS_LABELS[item.status]}</td>
                  <td>
                    {item.ownerIds.length && !item.check.some((c) => c.startsWith("No Owner")) ? (
                      item.ownerIds.map(name).join(", ")
                    ) : (
                      <select value={item.ownerIds[0] ?? ""} onChange={(e) => setOwner(i, e.target.value)} aria-label={`Owner of ${item.title}`}>
                        <option value="">Choose an Owner</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="hint">{item.check.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
