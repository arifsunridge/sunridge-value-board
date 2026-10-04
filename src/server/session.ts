import "server-only";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Member } from "@/board/model";
import { config } from "./config";

export interface SessionData {
  member?: Member;
  /** In-flight Microsoft sign-in. */
  signIn?: { state: string; verifier: string; returnTo: string };
}

function options(): SessionOptions {
  const c = config();
  return {
    cookieName: "svb_session",
    password: c.SESSION_SECRET,
    ttl: 60 * 60 * 12,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: c.NODE_ENV === "production", path: "/" },
  };
}

export async function session() {
  return getIronSession<SessionData>(await cookies(), options());
}

/** The signed-in Member, or a redirect to sign-in. */
export async function requireMember(returnTo = "/"): Promise<Member> {
  const s = await session();
  if (!s.member) redirect(`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`);
  return s.member;
}

/** Only allow same-site relative paths after sign-in. */
export function safeReturnTo(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
