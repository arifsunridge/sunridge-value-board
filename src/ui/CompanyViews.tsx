import Link from "next/link";

const VIEWS = [
  { slug: "", label: "Board" },
  { slug: "/summary", label: "Summary" },
  { slug: "/capture", label: "Capture" },
  { slug: "/areas", label: "Areas" },
] as const;

/** Switches between a Company's views. */
export function CompanyViews({
  companyId,
  current,
  isCompanyTeam = false,
}: {
  companyId: string;
  current: (typeof VIEWS)[number]["slug"];
  /** Capture and Areas are for Members only (ADR 0005). */
  isCompanyTeam?: boolean;
}) {
  const views = isCompanyTeam ? VIEWS.filter((v) => v.slug === "" || v.slug === "/summary") : VIEWS;
  return (
    <div className="chips" role="navigation" aria-label="Views">
      {views.map((v) => (
        <Link key={v.slug} href={`/c/${companyId}${v.slug}`} className="chip" aria-current={v.slug === current ? "page" : undefined}>
          {v.label}
        </Link>
      ))}
    </div>
  );
}
