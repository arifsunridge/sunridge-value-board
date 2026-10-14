import { describe, expect, it } from "vitest";
import type { AccessDecision } from "@arifsunridge/portal-kit";
import { personFromPortal } from "./portal-person";

const allowed = (audience: AccessDecision["audience"], role: string | null): AccessDecision => ({
  allowed: true,
  reason: "ok",
  role,
  audience,
  isAdmin: false,
});
const who = { email: "Someone@Example.com", name: "Someone Example" };

describe("who the HBF Portal's answer makes a Person (ADR 0005, 0006)", () => {
  it("makes Sunridge people Members, keyed by lower-cased email", () => {
    expect(personFromPortal(who, allowed("sunridge", "Member"), "hbf")).toEqual({
      id: "someone@example.com",
      email: "someone@example.com",
      name: "Someone Example",
      kind: "member",
      companyId: null,
    });
  });

  it("makes HBF people Managers of the portal's company", () => {
    expect(personFromPortal(who, allowed("hbf", "Manager"), "hbf")).toMatchObject({ kind: "manager", companyId: "hbf" });
  });

  it("never lets a role override the audience", () => {
    expect(personFromPortal(who, allowed("hbf", "Member"), "hbf")).toBe("audience");
    expect(personFromPortal(who, allowed("sunridge", "Manager"), "hbf")).toBe("audience");
    expect(personFromPortal(who, allowed("external", "Member"), "hbf")).toBe("audience");
    expect(personFromPortal(who, allowed("sunridge", null), "hbf")).toBe("audience");
  });

  it("refuses anyone the portal refuses, and says when the portal can't be reached", () => {
    const denied = { ...allowed("sunridge", null), allowed: false };
    expect(personFromPortal(who, { ...denied, reason: "no_grant" }, "hbf")).toBe("no_access");
    expect(personFromPortal(who, { ...denied, reason: "portal_unreachable" }, "hbf")).toBe("portal_unreachable");
  });
});
