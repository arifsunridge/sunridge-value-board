import Link from "next/link";

const VIEWS = [
  { slug: "", label: "Board" },
  { slug: "/summary", label: "Summary" },
  { slug: "/capture", label: "Capture" },
  { slug: "/areas", label: "Areas" },
] as const;

/** Switches between a Company's views. */
export function CompanyViews({ companyId, current }: { companyId: string; current: (typeof VIEWS)[number]["slug"] }) {
  return (
    <div className="chips" role="navigation" aria-label="Views">
      {VIEWS.map((v) => (
        <Link key={v.slug} href={`/c/${companyId}${v.slug}`} className="chip" aria-current={v.slug === current ? "page" : undefined}>
          {v.label}
        </Link>
      ))}
    </div>
  );
}
