import { notFound } from "next/navigation";
import { departmentName, PHASE_LABELS } from "@/board/model";
import { BoardError } from "@/board/rules";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { CompanyHead } from "@/ui/CompanyViews";
import { describe, formatWhen } from "@/ui/format";
import { ProgressBar, ProjectEditor, UpdateForm } from "@/ui/Projects";
import { TaskList } from "@/ui/TaskList";

export default async function ProjectPage({ params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const me = await requirePerson(`/c/${companyId}/projects/${projectId}`);
  const b = board();
  const detail = await b.project(me, projectId).catch((e) => {
    if (e instanceof BoardError && e.code === "not_found") notFound();
    throw e;
  });
  if (detail.project.companyId !== companyId) notFound();
  const [view, members] = await Promise.all([b.board(me, companyId), b.people(me)]);
  const { project, progress, tasks, updates, trail } = detail;
  const isMember = me.kind === "member";
  const area = view.areas.find((a) => a.id === project.areaId);
  const owner = project.ownerId ? (members.find((m) => m.id === project.ownerId)?.name ?? "Former member") : project.ownerName;
  const names = Object.fromEntries(view.areas.map((a) => [a.id, a.name]));

  return (
    <main>
      <CompanyHead company={view.company} current="/projects" isCompanyTeam={!isMember} />
      <section>
        <h2>
          {project.name}
          {project.phase && <span className={`phase ${project.phase}`} style={{ marginLeft: 12 }}>{PHASE_LABELS[project.phase]}</span>}
        </h2>
        <p className="muted small">
          {departmentName(project.departmentId)}
          {area ? ` › ${area.name}` : ""}
          {owner ? ` · Owner: ${owner}` : ""}
          {project.removed ? " · Removed" : ""}
        </p>
        {project.goal && <p>{project.goal}</p>}
        <ProgressBar done={progress.done} total={progress.total} />
        {(project.repository || project.portalApp || project.liveUrl) && (
          <p className="small">
            {project.repository && <>Repository: {project.repository}. </>}
            {project.portalApp && <>Portal app: {project.portalApp}. </>}
            {project.liveUrl && (
              <>
                Live at <a href={project.liveUrl}>{project.liveUrl}</a>.
              </>
            )}
          </p>
        )}
      </section>

      <section>
        <h2>Tasks</h2>
        <TaskList tasks={tasks} members={members} areas={view.areas} today={b.today()} empty="No Tasks in this Project yet." />
      </section>

      {isMember && (
        <>
          <section>
            <h2>Updates</h2>
            {updates.length === 0 && <p className="muted small">No Updates yet.</p>}
            <ul className="updates">
              {[...updates].reverse().map((u) => (
                <li key={u.id}>
                  <span>
                    {formatWhen(u.at)} · {u.byName}
                  </span>
                  <div>{u.text}</div>
                </li>
              ))}
            </ul>
            <UpdateForm projectId={project.id} />
          </section>
          <details>
            <summary>Change this Project</summary>
            <ProjectEditor project={project} areas={view.areas} members={members.filter((m) => m.kind === "member")} />
          </details>
          <details>
            <summary>Trail</summary>
            <ul className="updates">
              {trail.map((e) => (
                <li key={e.id}>
                  <span>{formatWhen(e.at)}</span> · {describe(e, members, names)}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </main>
  );
}
