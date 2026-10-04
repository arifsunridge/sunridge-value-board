import "server-only";
import type { EndpointOptions } from "@/claude/endpoint";
import { config } from "./config";
import { board } from "./context";

export function endpointOptions(): EndpointOptions {
  const c = config();
  return {
    board: board(),
    enabled: c.CLAUDE_ACCESS_ENABLED === "true",
    baseUrl: c.APP_BASE_URL.replace(/\/$/, ""),
    tenantId: c.ENTRA_TENANT_ID,
    clientId: c.ENTRA_CLIENT_ID,
    devTokens: c.AUTH_MODE === "dev",
  };
}
