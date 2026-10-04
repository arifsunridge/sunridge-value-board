import { NextResponse, type NextRequest } from "next/server";
import { board } from "@/server/context";
import { finishSignIn } from "@/server/entra";
import { session } from "@/server/session";

export async function GET(request: NextRequest) {
  const s = await session();
  const pending = s.signIn;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  s.signIn = undefined;
  if (!pending || !code || state !== pending.state) {
    await s.save();
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }
  try {
    const member = await finishSignIn(code, pending.verifier);
    await board().recordMember(member);
    s.member = member;
    await s.save();
    return NextResponse.redirect(new URL(pending.returnTo, request.url));
  } catch {
    await s.save();
    return new NextResponse("Sign-in failed. Only Sunridge accounts can use the board.", { status: 403 });
  }
}
