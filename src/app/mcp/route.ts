import { handleMcp } from "@/claude/endpoint";
import { endpointOptions } from "@/server/claude-endpoint";

// Claude's endpoint (spec P1.1): Model Context Protocol over Streamable HTTP.
async function handle(request: Request): Promise<Response> {
  return handleMcp(request, endpointOptions());
}

export { handle as GET, handle as POST, handle as DELETE };
