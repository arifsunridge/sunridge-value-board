import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { startSignIn } from "@/server/entra";
import { safeReturnTo, session } from "@/server/session";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  if (config().AUTH_MODE === "dev") {
    return NextResponse.redirect(new URL(`/auth/dev?returnTo=${encodeURIComponent(returnTo)}`, request.url));
  }
  const { url, state, verifier } = await startSignIn();
  const s = await session();
  s.signIn = { state, verifier, returnTo };
  await s.save();
  return NextResponse.redirect(url);
}
