import type { AccessDecision, PortalPerson } from "@arifsunridge/portal-kit";
import type { Person } from "@/board/model";
import { displayName } from "@/board/people";

/** Why someone can't get in, in words for the no-access page. Never shows the token or the portal's answer in full. */
export type Refusal = "signin" | "no_access" | "portal_unreachable" | "audience";

/**
 * Who a portal decision makes this person (ADR 0005, 0006). The kind comes from the audience the
 * portal verified, never from the role alone, so a mistaken role in App settings can't turn an
 * HBF team member into a Member. The role must agree as well.
 */
export function personFromPortal(
  identity: { email: string; name: string | null },
  decision: AccessDecision,
  companyTeamId: string,
): Person | Refusal {
  if (!decision.allowed) return decision.reason === "portal_unreachable" ? "portal_unreachable" : "no_access";
  const email = identity.email.toLowerCase();
  const base = { id: email, email, name: displayName(identity.name ?? "", email), signedInAt: null };
  if (decision.audience === "sunridge" && decision.role === "Sunridge team") return { ...base, kind: "member", companyId: null };
  if (decision.audience === "hbf" && decision.role === "HBF team") return { ...base, kind: "company", companyId: companyTeamId };
  return "audience";
}

/**
 * Someone from the HBF Portal's list of people the board lets in, as the board knows them before
 * they sign in (ADR 0009). The same audience-and-role rule as sign-in decides who they are; anyone
 * that rule refuses is left out.
 */
export function personFromDirectory(entry: PortalPerson, companyTeamId: string): Person | null {
  const person = personFromPortal(
    { email: entry.email, name: entry.name },
    { allowed: true, reason: "ok", audience: entry.audience, role: entry.role, isAdmin: false },
    companyTeamId,
  );
  return typeof person === "string" ? null : person;
}
