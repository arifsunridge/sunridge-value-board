import { protectedResourceMetadata } from "@/claude/endpoint";
import { endpointOptions } from "@/server/claude-endpoint";

export function GET() {
  const o = endpointOptions();
  if (!o.enabled) return new Response("Not found", { status: 404 });
  return Response.json(protectedResourceMetadata(o));
}
