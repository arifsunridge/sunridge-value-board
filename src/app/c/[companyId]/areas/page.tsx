import { notFound } from "next/navigation";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { AreasManager } from "@/ui/AreasManager";
import { CompanyViews } from "@/ui/CompanyViews";

export default async function AreasPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requirePerson(`/c/${companyId}/areas`);
  if (me.kind !== "member") notFound();
  const b = board();
  const [view, removed] = await Promise.all([b.board(me, companyId), b.removedTasks(me, companyId)]);
  return (
    <main>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{view.company.name}: Areas</h1>
        <CompanyViews companyId={companyId} current="/areas" />
      </div>
      <AreasManager
        companyId={companyId}
        areas={view.areas}
        openCounts={Object.fromEntries(
          view.areas.map((a) => [a.id, view.tasks.filter((t) => t.areaId === a.id && t.status !== "done").length]),
        )}
        removed={removed.map((t) => ({ id: t.id, title: t.title }))}
      />
    </main>
  );
}
