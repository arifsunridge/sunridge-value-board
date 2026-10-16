import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { CompanyHead } from "@/ui/CompanyViews";
import { Box, FoldBox, Tiles } from "@/ui/Panels";
import { PrivateMark } from "@/ui/PrivateMark";
import { TaskList } from "@/ui/TaskList";

/** The Partner view: two minutes to judge execution before a call. */
export default async function SummaryPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requirePerson(`/c/${companyId}/summary`);
  const b = board();
  const [summary, members, view] = await Promise.all([b.summary(me, companyId), b.people(me), b.board(me, companyId)]);
  const today = b.today();
  const areas = view.areas;
  const notes = Object.fromEntries(summary.changes.map((c) => [c.task.id, c.events.join(" · ")]));
  const open = new Set([...summary.attention, ...summary.overdue, ...summary.rest].map((t) => t.id)).size;
  const list = { members, areas, today };

  return (
    <main>
      <CompanyHead company={summary.company} current="/summary" isCompanyTeam={me.kind === "company"} />

      <Tiles
        tiles={[
          { label: "Need attention", count: summary.attention.length, href: "#attention" },
          { label: "Late", count: summary.overdue.length, href: "#late", alert: true },
          { label: "Changed this week", count: summary.changes.length, href: "#changed" },
          { label: "Open", count: open },
          ...(summary.private.length ? [{ label: "Your Private", count: summary.private.length, href: "#private" }] : []),
        ]}
      />

      <Box id="attention" title="Needs attention" count={summary.attention.length} hint="Blocked first, then High">
        <TaskList tasks={summary.attention} {...list} empty="Nothing is Blocked or High." />
      </Box>

      <Box id="late" title="Late" count={summary.overdue.length} hint="Open and past their due date">
        <TaskList tasks={summary.overdue} {...list} empty="Nothing is late." />
      </Box>

      <Box id="changed" title="Changed in the last 7 days" count={summary.changes.length}>
        <TaskList tasks={summary.changes.map((c) => c.task)} {...list} notes={notes} empty="No changes this week." />
      </Box>

      {summary.private.length > 0 && (
        <Box id="private" title="Your Private Tasks" count={summary.private.length} mark={<PrivateMark />} hint="Only their Owners and Contributors see these">
          <TaskList tasks={summary.private} {...list} />
        </Box>
      )}

      <FoldBox title="Everything else open" count={summary.rest.length}>
        <TaskList tasks={summary.rest} {...list} empty="Nothing else is open." />
      </FoldBox>
    </main>
  );
}
