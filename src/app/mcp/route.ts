import { handleMcp } from "@/claude/endpoint";
import { endpointOptions } from "@/server/claude-endpoint";
import { refreshPeople } from "@/server/people-directory";

// Claude's endpoint (spec P1.1): Model Context Protocol over Streamable HTTP.
async function handle(request: Request): Promise<Response> {
  // Claude can name colleagues as Owners before they ever sign in (ADR 0009).
  await refreshPeople();
  return handleMcp(request, endpointOptions());
}

export { handle as GET, handle as POST, handle as DELETE };
