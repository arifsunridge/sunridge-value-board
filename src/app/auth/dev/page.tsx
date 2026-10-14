import { notFound, redirect } from "next/navigation";
import { board } from "@/server/context";
import { config } from "@/server/config";
import { safeReturnTo, session } from "@/server/session";

// Local work only: choose a seeded Person. Config refuses AUTH_MODE=dev in production.
async function signInAs(formData: FormData) {
  "use server";
  if (config().AUTH_MODE !== "dev") notFound();
  const person = (await board().peopleForLocalSignIn()).find((p) => p.id === formData.get("personId"));
  if (!person) notFound();
  const s = await session();
  s.personId = person.id;
  await s.save();
  redirect(safeReturnTo(String(formData.get("returnTo") ?? "/")));
}

export default async function DevSignIn({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  if (config().AUTH_MODE !== "dev") notFound();
  const { returnTo } = await searchParams;
  const people = await board().peopleForLocalSignIn();
  return (
    <main className="narrow">
      <h1>Sign in (local)</h1>
      <p className="muted">The HBF Portal sign-in is off on this machine. Choose who you are.</p>
      <form action={signInAs} className="stack">
        <input type="hidden" name="returnTo" value={safeReturnTo(returnTo)} />
        {people.map((p) => (
          <button key={p.id} name="personId" value={p.id} className="button secondary">
            {p.name}
            {p.kind === "company" ? " (HBF team)" : ""}
          </button>
        ))}
      </form>
    </main>
  );
}
