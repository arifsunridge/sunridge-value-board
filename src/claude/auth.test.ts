import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { memberFromToken } from "./auth";

const tenantId = "tenant-sunridge";
const clientId = "client-board";
const resource = "https://board.example.com/mcp";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, over: { issuer?: string; audience?: string; expires?: string } = {}) =>
    new SignJWT({ tid: tenantId, oid: "m-theran", name: "Theran Example", preferred_username: "theran@example.com", scp: "Board.ReadWrite", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(over.issuer ?? `https://login.microsoftonline.com/${tenantId}/v2.0`)
      .setAudience(over.audience ?? clientId)
      .setIssuedAt()
      .setExpirationTime(over.expires ?? "10m")
      .sign(privateKey);
  return { keys, sign };
}

describe("Claude access tokens", () => {
  it("accepts a Sunridge token for this board and returns its Member", async () => {
    const { keys, sign } = await setup();
    await expect(memberFromToken(await sign({}), { tenantId, clientId, resource, keys })).resolves.toEqual({
      id: "m-theran",
      name: "Theran Example",
      email: "theran@example.com",
    });
    // Tokens whose audience is the endpoint address are accepted too.
    await expect(memberFromToken(await sign({}, { audience: resource }), { tenantId, clientId, resource, keys })).resolves.toBeTruthy();
  });

  it("refuses another tenant, another app, an expired token or a missing scope", async () => {
    const { keys, sign } = await setup();
    const check = { tenantId, clientId, resource, keys };
    await expect(memberFromToken(await sign({}, { issuer: "https://login.microsoftonline.com/other/v2.0" }), check)).rejects.toMatchObject({ reason: "invalid" });
    await expect(memberFromToken(await sign({ tid: "other" }), check)).rejects.toMatchObject({ reason: "invalid" });
    await expect(memberFromToken(await sign({}, { audience: "some-other-app" }), check)).rejects.toMatchObject({ reason: "invalid" });
    await expect(memberFromToken(await sign({}, { expires: "-1m" }), check)).rejects.toMatchObject({ reason: "invalid" });
    await expect(memberFromToken(await sign({ scp: "User.Read" }), check)).rejects.toMatchObject({ reason: "scope" });
    await expect(memberFromToken("not-a-token", check)).rejects.toMatchObject({ reason: "invalid" });
  });
});
