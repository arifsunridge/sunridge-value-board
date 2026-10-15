import Link from "next/link";
import type { Company } from "@/board/model";

const VIEWS = [
  { slug: "", label: "Board" },
  { slug: "/summary", label: "Summary" },
  { slug: "/capture", label: "Capture" },
  { slug: "/areas", label: "Areas" },
] as const;

/** A Company's heading, with its views. The board puts its counts and filters on the right. */
export function CompanyHead({
  company,
  current,
  isCompanyTeam = false,
  children,
}: {
  company: Pick<Company, "id" | "name" | "kind">;
  current: (typeof VIEWS)[number]["slug"];
  /** Capture and Areas are for Members only (ADR 0005). */
  isCompanyTeam?: boolean;
  children?: React.ReactNode;
}) {
  const views = isCompanyTeam ? VIEWS.filter((v) => v.slug === "" || v.slug === "/summary") : VIEWS;
  return (
    <>
      <div className="co-head">
        <h2>
          {company.name}
          <span className="bar-g">|</span>
          <em>{company.kind === "portfolio" ? "Portfolio company" : "Sunridge"}</em>
        </h2>
        <nav className="seg" aria-label="Views">
          {views.map((v) => (
            <Link key={v.slug} href={`/c/${company.id}${v.slug}`} aria-current={v.slug === current ? "page" : undefined}>
              {v.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </>
  );
}
