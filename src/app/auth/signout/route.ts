import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/server/config";
import { session } from "@/server/session";

/** Local sign-out. Through the portal, signing out happens on the portal's sign-in page, which ends every app's session. */
export async function POST(request: NextRequest) {
  if (config().AUTH_MODE === "portal") return NextResponse.redirect(new URL("/?signed-out", config().PORTAL_URL), 303);
  const s = await session();
  s.destroy();
  return NextResponse.redirect(new URL("/signed-out", request.url), 303);
}
