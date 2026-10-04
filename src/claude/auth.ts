import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Member } from "@/board/model";

/** The one delegated scope Claude needs: act on the board as the signed-in Member. */
export const BOARD_SCOPE = "Board.ReadWrite";

export class AccessDenied extends Error {
  constructor(
    message: string,
    readonly reason: "missing" | "invalid" | "scope",
  ) {
    super(message);
    this.name = "AccessDenied";
  }
}

export interface TokenCheck {
  tenantId: string;
  clientId: string;
  /** The endpoint's address, which is also the app's Application ID URI (Claude sends it as the token's resource). */
  resource: string;
  /** Signing keys. Defaults to Entra's published keys for the tenant. */
  keys?: JWTVerifyGetKey;
}

const keyCache = new Map<string, JWTVerifyGetKey>();

function entraKeys(tenantId: string): JWTVerifyGetKey {
  let keys = keyCache.get(tenantId);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
    keyCache.set(tenantId, keys);
  }
  return keys;
}

/**
 * Checks a Microsoft Entra access token issued to Claude for this board and returns the
 * Member it speaks for. Only v2 tokens from the Sunridge tenant (ADR 0001), for this app,
 * carrying Board.ReadWrite, are accepted.
 */
export async function memberFromToken(token: string, check: TokenCheck): Promise<Member> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, check.keys ?? entraKeys(check.tenantId), {
      issuer: `https://login.microsoftonline.com/${check.tenantId}/v2.0`,
      audience: [check.clientId, check.resource],
      algorithms: ["RS256"],
    }));
  } catch {
    throw new AccessDenied("The access token isn't valid for this board.", "invalid");
  }
  if (payload.tid !== check.tenantId || typeof payload.oid !== "string") {
    throw new AccessDenied("Only Sunridge accounts can use the board.", "invalid");
  }
  const scopes = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
  if (!scopes.includes(BOARD_SCOPE)) {
    throw new AccessDenied(`The access token lacks the ${BOARD_SCOPE} permission.`, "scope");
  }
  const email = typeof payload.preferred_username === "string" ? payload.preferred_username : "";
  const name = typeof payload.name === "string" ? payload.name : email || "Member";
  return { id: payload.oid, name, email };
}
