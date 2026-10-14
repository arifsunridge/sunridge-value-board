import { notFound } from "next/navigation";
import { isMember } from "@/board/model";
import { board } from "@/server/context";
import { requirePerson } from "@/server/session";
import { ImportScreen } from "@/ui/ImportScreen";

/** Members bring Tasks across from the team board: upload the review file, tick what to import, import. */
export default async function ImportPage() {
  const me = await requirePerson("/import");
  if (!isMember(me)) notFound();
  const people = await board().people(me);
  return (
    <main>
      <h1>Import Tasks</h1>
      <p className="muted">
        Upload the review file prepared from the team board. Check every Task, untick any you don’t want, then import. Tasks come in
        as you, not shared, and anything already on the board is skipped.
      </p>
      <ImportScreen people={people.filter(isMember).map((p) => ({ id: p.id, name: p.name }))} />
    </main>
  );
}
