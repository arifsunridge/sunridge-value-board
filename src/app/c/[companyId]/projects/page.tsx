import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { CompanyHead } from "@/ui/CompanyViews";
import { ProjectList, NewProjectForm } from "@/ui/Projects";

/** A Company's Projects: what each is for, who owns it, where it stands and how far it has got (ADR 0008). */
export default async function ProjectsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requirePerson(`/c/${companyId}/projects`);
  const b = board();
  const [view, members] = await Promise.all([b.board(me, companyId), b.people(me)]);
  const isMember = me.kind === "member";
  return (
    <main>
      <CompanyHead company={view.company} current="/projects" isCompanyTeam={!isMember} />
      <p className="muted">A Project groups Tasks in one Department or Area, with a goal, an Owner and a Phase. Progress counts its Done Tasks.</p>
      <ProjectList companyId={companyId} projects={view.projects} areas={view.areas} members={members} />
      {isMember && <NewProjectForm companyId={companyId} areas={view.areas} members={members.filter((m) => m.kind === "member")} />}
    </main>
  );
}
