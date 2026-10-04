import { notFound, redirect } from "next/navigation";
import { board } from "@/server/context";
import { config } from "@/server/config";
import { safeReturnTo, session } from "@/server/session";

// Local work only: choose a seeded Member. Config refuses AUTH_MODE=dev in production.
async function signInAs(formData: FormData) {
  "use server";
  if (config().AUTH_MODE !== "dev") notFound();
  const member = (await board().members()).find((m) => m.id === formData.get("memberId"));
  if (!member) notFound();
  const s = await session();
  s.member = member;
  await s.save();
  redirect(safeReturnTo(String(formData.get("returnTo") ?? "/")));
}

export default async function DevSignIn({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  if (config().AUTH_MODE !== "dev") notFound();
  const { returnTo } = await searchParams;
  const members = await board().members();
  return (
    <main className="narrow">
      <h1>Sign in (local)</h1>
      <p className="muted">Microsoft sign-in is off on this machine. Choose who you are.</p>
      <form action={signInAs} className="stack">
        <input type="hidden" name="returnTo" value={safeReturnTo(returnTo)} />
        {members.map((m) => (
          <button key={m.id} name="memberId" value={m.id} className="button secondary">
            {m.name}
          </button>
        ))}
      </form>
    </main>
  );
}
