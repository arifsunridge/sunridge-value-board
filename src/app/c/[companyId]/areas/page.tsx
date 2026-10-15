import { notFound } from "next/navigation";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { AreasManager } from "@/ui/AreasManager";
import { CompanyHead } from "@/ui/CompanyViews";

export default async function AreasPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requirePerson(`/c/${companyId}/areas`);
  if (me.kind !== "member") notFound();
  const b = board();
  const [view, removed] = await Promise.all([b.board(me, companyId), b.removedTasks(me, companyId)]);
  return (
    <main>
      <CompanyHead company={view.company} current="/areas" />
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
