import "server-only";
import { readFileSync } from "node:fs";
import { ConfidentialClientApplication } from "@azure/msal-node";
import type { Config } from "./config";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** A Graph failure. Carries the status and Graph's error code, never the request or response body. */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly graphCode: string | null,
  ) {
    super(`Microsoft Graph request failed (${status}${graphCode ? `, ${graphCode}` : ""}).`);
    this.name = "GraphError";
  }
}

/**
 * Microsoft Graph as the app's own identity (ADR 0003). The app registration holds
 * Sites.Selected, granted by IT to the board's one SharePoint site.
 */
export class Graph {
  constructor(
    readonly siteId: string,
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromConfig(c: Config): Graph {
    const privateKey =
      c.ENTRA_CERT_PRIVATE_KEY ?? (c.ENTRA_CERT_PRIVATE_KEY_PATH ? readFileSync(c.ENTRA_CERT_PRIVATE_KEY_PATH, "utf8") : "");
    if (!c.ENTRA_CLIENT_ID || !c.ENTRA_TENANT_ID || !c.ENTRA_CERT_THUMBPRINT_SHA256 || !privateKey || !c.SHAREPOINT_SITE_ID) {
      throw new Error("Microsoft Lists is not configured: set the ENTRA_* certificate settings and SHAREPOINT_SITE_ID.");
    }
    const app = new ConfidentialClientApplication({
      auth: {
        clientId: c.ENTRA_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${c.ENTRA_TENANT_ID}`,
        clientCertificate: { thumbprintSha256: c.ENTRA_CERT_THUMBPRINT_SHA256, privateKey },
      },
    });
    return new Graph(c.SHAREPOINT_SITE_ID, async () => {
      const result = await app.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
      if (!result?.accessToken) throw new Error("Could not get a Microsoft Graph token for the app.");
      return result.accessToken;
    });
  }

  /** Path prefix for the board's site. */
  get site(): string {
    return `/sites/${this.siteId}`;
  }

  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const url = path.startsWith("https://") ? path : `${GRAPH}${path}`;
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if ((response.status === 429 || response.status === 503) && attempt < 3) {
        const wait = Number(response.headers.get("Retry-After") ?? 2 ** attempt);
        await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
        continue;
      }
      if (!response.ok) {
        const code = await response
          .json()
          .then((j: { error?: { code?: string } }) => j.error?.code ?? null)
          .catch(() => null);
        throw new GraphError(response.status, code);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
  }

  /** Follows @odata.nextLink until every page is read. */
  async all<T>(path: string, headers: Record<string, string> = {}): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: { value: T[]; "@odata.nextLink"?: string } = await this.request("GET", next, undefined, headers);
      items.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return items;
  }

  /** Uploads bytes to a pre-authorised upload URL (no Authorization header, per Graph's rules). */
  async uploadChunk(uploadUrl: string, bytes: Uint8Array<ArrayBuffer>, start: number, total: number): Promise<Response> {
    const end = start + bytes.length - 1;
    const response = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(bytes.length), "Content-Range": `bytes ${start}-${end}/${total}` },
      body: bytes,
    });
    if (!response.ok) throw new GraphError(response.status, null);
    return response;
  }
}
