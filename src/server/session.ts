import "server-only";
import { createAccessVerifier, type AccessVerifier } from "@arifsunridge/portal-kit";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import type { Person } from "@/board/model";
import { config } from "./config";
import { board, portal } from "./context";
import { refreshPeople } from "./people-directory";
import { personFromPortal, type Refusal } from "./portal-person";

/** Local work only (AUTH_MODE=dev): who you chose to be. */
export interface SessionData {
  personId?: string;
}

function options(): SessionOptions {
  const c = config();
  return {
    cookieName: "svb_session",
    password: c.SESSION_SECRET!,
    ttl: 60 * 60 * 12,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: c.NODE_ENV === "production", path: "/" },
  };
}

export async function session() {
  return getIronSession<SessionData>(await cookies(), options());
}

const holder = globalThis as unknown as { __svbVerifier?: AccessVerifier };

function verifier(): AccessVerifier {
  const c = config();
  holder.__svbVerifier ??= createAccessVerifier({ teamDomain: c.CF_ACCESS_TEAM_DOMAIN!, audience: c.CF_ACCESS_AUD! });
  return holder.__svbVerifier;
}

async function fromPortal(): Promise<Person | Refusal> {
  const h = await headers();
  const token = h.get("cf-access-jwt-assertion") ?? (await cookies()).get("CF_Authorization")?.value;
  if (!token) return "signin";
  let identity;
  try {
    identity = await verifier()(token);
  } catch {
    return "signin";
  }
  const person = personFromPortal(identity, await portal().getAccess(identity.email), config().PORTAL_COMPANY_ID);
  if (typeof person === "string") return person;
  await board().recordPerson(person);
  await refreshPeople();
  return person;
}

/** The signed-in Person, or null. */
export async function currentPerson(): Promise<Person | null> {
  // Who is signed in is known only at request time, as is the configuration it depends on.
  await connection();
  if (config().AUTH_MODE === "portal") {
    const result = await fromPortal();
    return typeof result === "string" ? null : result;
  }
  const id = (await session()).personId;
  return id ? board().me({ memberId: id }).catch(() => null) : null;
}

/** The signed-in Person, or a redirect: to the local sign-in in dev, or to the no-access page. */
export async function requirePerson(returnTo = "/"): Promise<Person> {
  await connection();
  if (config().AUTH_MODE === "portal") {
    const result = await fromPortal();
    if (typeof result === "string") redirect(`/no-access?reason=${result}`);
    return result;
  }
  const person = await currentPerson();
  if (!person) redirect(`/auth/dev?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
  return person;
}

/** Only allow same-site relative paths after sign-in. */
export function safeReturnTo(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
