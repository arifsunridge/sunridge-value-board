import { board } from "@/server/context";
import { requireMember } from "@/server/session";
import { CompanyViews } from "@/ui/CompanyViews";
import { TaskList } from "@/ui/TaskList";

/** The Partner view: two minutes to judge execution before a call. */
export default async function SummaryPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await requireMember(`/c/${companyId}/summary`);
  const b = board();
  const [summary, members, view] = await Promise.all([b.summary(companyId), b.members(), b.board(companyId)]);
  const today = b.today();
  const areas = view.areas;
  const notes = Object.fromEntries(summary.changes.map((c) => [c.task.id, c.events.join(" · ")]));

  return (
    <main>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{summary.company.name}: summary</h1>
        <CompanyViews companyId={companyId} current="/summary" />
      </div>

      <section>
        <h2>Needs attention</h2>
        <p className="muted small">Blocked first, then High.</p>
        <TaskList tasks={summary.attention} members={members} areas={areas} today={today} empty="Nothing is Blocked or High." />
      </section>

      <section>
        <h2>Overdue</h2>
        <TaskList tasks={summary.overdue} members={members} areas={areas} today={today} empty="Nothing is overdue." />
      </section>

      <section>
        <h2>Changed in the last 7 days</h2>
        <TaskList
          tasks={summary.changes.map((c) => c.task)}
          members={members}
          areas={areas}
          today={today}
          notes={notes}
          empty="No changes this week."
        />
      </section>

      <details>
        <summary>
          <h2 style={{ display: "inline" }}>Everything else open</h2>
        </summary>
        <TaskList tasks={summary.rest} members={members} areas={areas} today={today} />
      </details>
    </main>
  );
}
