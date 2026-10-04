import { notFound } from "next/navigation";
import { canEdit } from "@/board/board";
import { BoardError } from "@/board/rules";
import { board } from "@/server/context";
import { requireMember } from "@/server/session";
import { BoardScreen } from "@/ui/BoardScreen";
import { CompanyViews } from "@/ui/CompanyViews";
import { TaskPanel, type PanelData } from "@/ui/TaskPanel";

export default async function CompanyBoard({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ task?: string; filter?: string }>;
}) {
  const { companyId } = await params;
  const { task: taskId, filter } = await searchParams;
  const me = await requireMember(`/c/${companyId}`);
  const b = board();

  const view = await b.board(companyId).catch((e) => {
    if (e instanceof BoardError && e.code === "not_found") notFound();
    throw e;
  });
  const [members, companies] = await Promise.all([b.members(), b.companies()]);

  let panel: PanelData | null = null;
  if (taskId === "new") {
    panel = { mode: "new" };
  } else if (taskId) {
    const detail = await b.task(taskId).catch(() => null);
    if (detail && detail.task.companyId === companyId) {
      const allAreas = await Promise.all(companies.map((c) => b.board(c.id).then((v) => v.areas)));
      panel = {
        mode: "edit",
        ...detail,
        canEdit: canEdit(detail.task, me.id),
        allAreas: allAreas.flat(),
        // Tasks this Member can move a Document to.
        moveTargets: view.tasks
          .filter((t) => t.id !== detail.task.id && canEdit(t, me.id))
          .map((t) => ({ id: t.id, title: t.title })),
      };
    }
  }

  return (
    <main>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{view.company.name}</h1>
        <CompanyViews companyId={companyId} current="" />
      </div>
      <BoardScreen view={view} members={members} meId={me.id} today={b.today()} filter={filter ?? "all"} />
      {panel && (
        <TaskPanel
          data={panel}
          company={view.company}
          companies={companies}
          areas={view.areas}
          members={members}
          meId={me.id}
        />
      )}
    </main>
  );
}
