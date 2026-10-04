import "server-only";
import { ConfidentialClientApplication, CryptoProvider } from "@azure/msal-node";
import { config } from "./config";

// Sign-in only: the one delegated permission is User.Read (ADR 0003).
const SCOPES = ["openid", "profile", "email", "User.Read"];

let client: ConfidentialClientApplication | undefined;

function msal(): ConfidentialClientApplication {
  const c = config();
  client ??= new ConfidentialClientApplication({
    auth: {
      clientId: c.ENTRA_CLIENT_ID!,
      // Single tenant: only Sunridge accounts can sign in (ADR 0001).
      authority: `https://login.microsoftonline.com/${c.ENTRA_TENANT_ID}`,
      clientSecret: c.ENTRA_CLIENT_SECRET!,
    },
  });
  return client;
}

const redirectUri = () => `${config().APP_BASE_URL}/auth/callback`;

export async function startSignIn(): Promise<{ url: string; state: string; verifier: string }> {
  const crypto = new CryptoProvider();
  const { verifier, challenge } = await crypto.generatePkceCodes();
  const state = crypto.createNewGuid();
  const url = await msal().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: redirectUri(),
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state,
    prompt: "select_account",
  });
  return { url, state, verifier };
}

export interface SignedIn {
  id: string;
  name: string;
  email: string;
}

export async function finishSignIn(code: string, verifier: string): Promise<SignedIn> {
  const result = await msal().acquireTokenByCode({ code, scopes: SCOPES, redirectUri: redirectUri(), codeVerifier: verifier });
  const claims = result.idTokenClaims as { oid?: string; tid?: string; name?: string; preferred_username?: string };
  if (claims.tid !== config().ENTRA_TENANT_ID || !claims.oid) {
    throw new Error("Only Sunridge accounts can sign in.");
  }
  return { id: claims.oid, name: claims.name ?? claims.preferred_username ?? "Member", email: claims.preferred_username ?? "" };
}
