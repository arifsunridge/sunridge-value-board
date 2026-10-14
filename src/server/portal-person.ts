import type { AccessDecision } from "@arifsunridge/portal-kit";
import type { Person } from "@/board/model";

/** Why someone can't get in, in words for the no-access page. Never shows the token or the portal's answer in full. */
export type Refusal = "signin" | "no_access" | "portal_unreachable" | "audience";

/**
 * Who a portal decision makes this person (ADR 0005, 0006). The kind comes from the audience the
 * portal verified, never from the role alone, so a mistaken role in App settings can't turn an
 * HBF Manager into a Member. The role must agree as well.
 */
export function personFromPortal(
  identity: { email: string; name: string | null },
  decision: AccessDecision,
  managerCompanyId: string,
): Person | Refusal {
  if (!decision.allowed) return decision.reason === "portal_unreachable" ? "portal_unreachable" : "no_access";
  const email = identity.email.toLowerCase();
  const base = { id: email, email, name: identity.name || email };
  if (decision.audience === "sunridge" && decision.role === "Member") return { ...base, kind: "member", companyId: null };
  if (decision.audience === "hbf" && decision.role === "Manager") return { ...base, kind: "manager", companyId: managerCompanyId };
  return "audience";
}
