import { notFound } from "next/navigation";
import { BoardError } from "@/board/rules";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { BoardScreen } from "@/ui/BoardScreen";
import { TaskPanel, type PanelData } from "@/ui/TaskPanel";

export default async function CompanyBoard({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ task?: string; filter?: string; owner?: string; empty?: string; projects?: string }>;
}) {
  const { companyId } = await params;
  const { task: taskId, filter, owner, empty, projects } = await searchParams;
  const me = await requirePerson(`/c/${companyId}`);
  const isCompanyTeam = me.kind === "company";
  const b = board();

  const view = await b.board(me, companyId).catch((e) => {
    if (e instanceof BoardError && e.code === "not_found") notFound();
    throw e;
  });
  const [members, companies] = await Promise.all([b.people(me), b.companies(me)]);

  let panel: PanelData | null = null;
  if (taskId === "new" && !isCompanyTeam) {
    panel = { mode: "new" };
  } else if (taskId) {
    const detail = await b.task(me, taskId).catch(() => null);
    if (detail && detail.task.companyId === companyId) {
      const allAreas = await Promise.all(companies.map((c) => b.board(me, c.id).then((v) => v.areas)));
      panel = {
        mode: "edit",
        ...detail,
        canEdit: view.editable.includes(detail.task.id),
        allAreas: allAreas.flat(),
        // Tasks this Person can move a Document to.
        moveTargets: view.tasks.filter((t) => t.id !== detail.task.id && view.editable.includes(t.id)).map((t) => ({ id: t.id, title: t.title })),
      };
    }
  }

  return (
    <main>
      <BoardScreen
        view={view}
        members={members}
        meId={me.id}
        isCompanyTeam={isCompanyTeam}
        today={b.today()}
        filter={filter ?? "all"}
        owner={owner ?? ""}
        showEmpty={empty === "1"}
        showProjects={projects !== "0"}
      />
      {panel && (
        <TaskPanel
          data={panel}
          company={view.company}
          companies={companies}
          areas={view.areas}
          projects={view.projects.map((p) => p.project)}
          members={members}
          meId={me.id}
          isCompanyTeam={isCompanyTeam}
        />
      )}
    </main>
  );
}
