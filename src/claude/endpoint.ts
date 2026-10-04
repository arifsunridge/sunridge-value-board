import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Board } from "@/board/board";
import type { Member } from "@/board/model";
import { AccessDenied, BOARD_SCOPE, memberFromToken } from "./auth";
import { boardServer } from "./tools";

export interface EndpointOptions {
  board: Board;
  /** Off until spec question Q1 (may Claude read company content?) is answered. */
  enabled: boolean;
  /** Public address of the app, e.g. https://board.example.com */
  baseUrl: string;
  tenantId?: string;
  clientId?: string;
  /** Local work only: accept "Bearer dev:<member id>". Config refuses dev sign-in in production. */
  devTokens: boolean;
  /** Overrides token checking (tests). */
  verify?: (token: string) => Promise<Member>;
}

export const MCP_PATH = "/mcp";
export const METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

/**
 * The endpoint's address doubles as the app's Application ID URI: Claude sends it as the
 * OAuth resource, and Entra only accepts a resource that matches an Application ID URI.
 */
export function resource(baseUrl: string): string {
  return `${baseUrl}${MCP_PATH}`;
}

export function scope(baseUrl: string): string {
  return `${resource(baseUrl)}/${BOARD_SCOPE}`;
}

/** RFC 9728 metadata: tells Claude where to get a token for this board. */
export function protectedResourceMetadata(o: Pick<EndpointOptions, "baseUrl" | "tenantId">) {
  return {
    resource: resource(o.baseUrl),
    authorization_servers: [`https://login.microsoftonline.com/${o.tenantId}/v2.0`],
    scopes_supported: [scope(o.baseUrl)],
    bearer_methods_supported: ["header"],
    resource_name: "Sunridge Value Board",
  };
}

function challenge(o: EndpointOptions, error?: AccessDenied): Response {
  const parts = [`resource_metadata="${o.baseUrl}${METADATA_PATH}"`, `scope="${scope(o.baseUrl)}"`];
  if (error) parts.push(`error="${error.reason === "scope" ? "insufficient_scope" : "invalid_token"}"`);
  return new Response(JSON.stringify({ error: error?.message ?? "Sign in with your Sunridge Microsoft account." }), {
    status: error?.reason === "scope" ? 403 : 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": `Bearer ${parts.join(", ")}` },
  });
}

async function member(token: string, o: EndpointOptions): Promise<Member> {
  if (o.verify) return o.verify(token);
  if (o.devTokens && token.startsWith("dev:")) {
    const found = (await o.board.members()).find((m) => m.id === token.slice(4));
    if (!found) throw new AccessDenied("No such Member.", "invalid");
    return found;
  }
  if (!o.tenantId || !o.clientId) throw new AccessDenied("Claude access isn't configured.", "invalid");
  return memberFromToken(token, { tenantId: o.tenantId, clientId: o.clientId, resource: resource(o.baseUrl) });
}

/**
 * The board's MCP endpoint (Streamable HTTP, stateless). Each request carries the
 * Member's own Entra access token; tools act as that Member with the same rules as the screen.
 */
export async function handleMcp(request: Request, o: EndpointOptions): Promise<Response> {
  if (!o.enabled) return new Response("Not found", { status: 404 });

  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return challenge(o);

  let who: Member;
  try {
    who = await member(token, o);
  } catch (error) {
    if (error instanceof AccessDenied) return challenge(o, error);
    throw error;
  }
  await o.board.recordMember(who);

  const server = boardServer(o.board, { memberId: who.id, via: "claude" });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
