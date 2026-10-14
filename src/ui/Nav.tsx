"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ companies, canImport = false }: { companies: { id: string; name: string }[]; canImport?: boolean }) {
  const path = usePathname();
  const current = (href: string) => (path === href || path.startsWith(`${href}/`) ? "page" : undefined);
  return (
    <nav className="nav" aria-label="Companies">
      {companies.map((c) => (
        <Link key={c.id} href={`/c/${c.id}`} aria-current={current(`/c/${c.id}`)}>
          {c.name}
        </Link>
      ))}
      <Link href="/my" aria-current={current("/my")}>
        My Tasks
      </Link>
      {canImport && (
        <Link href="/import" aria-current={current("/import")}>
          Import
        </Link>
      )}
    </nav>
  );
}
