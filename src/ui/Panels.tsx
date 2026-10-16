/** Count tiles and ruled boxes, for the reading views: the Summary and My Tasks. */

export interface Tile {
  label: string;
  count: number;
  /** The section it jumps to. */
  href?: string;
  /** Show the count in the High colour when it isn't zero, such as Late. */
  alert?: boolean;
}

export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="tiles">
      {tiles.map((t) => {
        const body = (
          <>
            <b>{t.count}</b>
            <span>{t.label}</span>
          </>
        );
        const className = `tile${t.alert && t.count > 0 ? " alert" : ""}`;
        return t.href ? (
          <a key={t.label} className={className} href={t.href}>
            {body}
          </a>
        ) : (
          <div key={t.label} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** A section in a ruled box, with its heading, a count and an optional hint on the right. */
export function Box({
  id,
  title,
  count,
  hint,
  mark,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  hint?: string;
  mark?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="sbox" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <header className="sbox-h">
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {mark}
        {count !== undefined && <span className="count">{count}</span>}
        {hint && <span className="hint">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

/** A Box that opens and closes, for the long tail such as "Everything else open" or Done. */
export function FoldBox({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="sbox">
      <summary className="sbox-h">
        <h2>{title}</h2>
        <span className="count">{count}</span>
        <span className="hint">Show</span>
      </summary>
      {children}
    </details>
  );
}
