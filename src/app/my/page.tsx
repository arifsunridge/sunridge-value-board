import { board } from "@/server/context";
import { requireMember } from "@/server/session";
import { TaskList } from "@/ui/TaskList";

export default async function MyTasks() {
  const me = await requireMember("/my");
  const b = board();
  const [tasks, members, companies] = await Promise.all([b.myTasks(me.id), b.members(), b.companies()]);
  const areas = (await Promise.all(companies.map((c) => b.board(c.id).then((v) => v.areas)))).flat();
  const today = b.today();
  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <main>
      <h1>My Tasks</h1>
      <p className="muted">Tasks you own or contribute to, across every company.</p>
      {companies.map((c) => {
        const mine = open.filter((t) => t.companyId === c.id);
        return mine.length ? (
          <section key={c.id}>
            <h2>{c.name}</h2>
            <TaskList tasks={mine} members={members} areas={areas} today={today} />
          </section>
        ) : null;
      })}
      {!open.length && <p>Nothing open. Add a Task from a company’s board, or use Capture after your next meeting.</p>}
      {done.length > 0 && (
        <details>
          <summary>Done</summary>
          <TaskList tasks={done} members={members} areas={areas} today={today} />
        </details>
      )}
    </main>
  );
}
