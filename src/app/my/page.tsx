import { isOverdue } from "@/board/board";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { Box, FoldBox, Tiles } from "@/ui/Panels";
import { TaskList } from "@/ui/TaskList";

export default async function MyTasks() {
  const me = await requirePerson("/my");
  const b = board();
  const [tasks, members, companies] = await Promise.all([b.myTasks(me), b.people(me), b.companies(me)]);
  const areas = (await Promise.all(companies.map((c) => b.board(me, c.id).then((v) => v.areas)))).flat();
  const today = b.today();
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const list = { members, areas, today };

  return (
    <main>
      <header className="page-head">
        <h1>My Tasks</h1>
        <p className="muted">Tasks you own or contribute to, across every company. Private ones carry a lock: only their Owners and Contributors see them.</p>
      </header>

      <Tiles
        tiles={[
          { label: "Open", count: open.length },
          { label: "Now", count: open.filter((t) => t.status === "now").length },
          { label: "Blocked", count: open.filter((t) => t.status === "blocked").length },
          { label: "Late", count: open.filter((t) => isOverdue(t, today)).length, alert: true },
          { label: "Private", count: open.filter((t) => t.private).length },
        ]}
      />

      {companies.map((c) => {
        const mine = open.filter((t) => t.companyId === c.id);
        return mine.length ? (
          <Box key={c.id} id={`c-${c.id}`} title={c.name} count={mine.length}>
            <TaskList tasks={mine} {...list} />
          </Box>
        ) : null;
      })}
      {!open.length && <p>Nothing open. Add a Task from a company’s board, or use Capture after your next meeting.</p>}
      {done.length > 0 && (
        <FoldBox title="Done" count={done.length}>
          <TaskList tasks={done} {...list} />
        </FoldBox>
      )}
    </main>
  );
}
