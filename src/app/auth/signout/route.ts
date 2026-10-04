import { NextResponse, type NextRequest } from "next/server";
import { session } from "@/server/session";

export async function POST(request: NextRequest) {
  const s = await session();
  s.destroy();
  return NextResponse.redirect(new URL("/signed-out", request.url), 303);
}
