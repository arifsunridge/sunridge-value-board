"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The masthead's tabs, and the Company switch that keeps the current view. */
export function Nav({ companies, canImport = false }: { companies: { id: string; name: string }[]; canImport?: boolean }) {
  const path = usePathname();
  const match = path.match(/^\/c\/([^/]+)(\/.*)?$/);
  const currentCompany = match?.[1] ?? null;
  const subView = match?.[2] ?? "";
  const boardHref = `/c/${currentCompany ?? companies[0]?.id ?? ""}`;
  const tab = (href: string, active: boolean, label: string) => (
    <Link href={href} role="tab" aria-selected={active}>
      {label}
    </Link>
  );
  return (
    <div className="navrow">
      <nav className="tabs" aria-label="Views">
        {companies.length > 0 && tab(boardHref, currentCompany !== null, "Board")}
        {tab("/my", path === "/my", "My Tasks")}
        {canImport && tab("/import", path === "/import", "Import")}
      </nav>
      {companies.length > 1 && (
        <div className="cos" role="group" aria-label="Company">
          <span>Company</span>
          {companies.map((c) => (
            <Link key={c.id} href={`/c/${c.id}${subView}`} className="btn" aria-pressed={c.id === currentCompany}>
              {c.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
