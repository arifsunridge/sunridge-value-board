---
status: accepted
amends: 0005, 0007
---

# Owners can be anyone, a Task can wait for one, and the HBF Portal says who is on the board

On the board almost every Task showed Arif as Owner. The team board only lets someone who has opened the artifact be an Owner, the board only let someone who had signed in be one, and the sync gave every Task it couldn't place to the syncing Member. Arif decided on 16 October 2026 that work can be owned by any Sunridge colleague whether or not they use the board, by name if need be, and that a Task may have no Owner yet.

## Decisions

- **Owners are optional.** A Task can have no Owner. The board shows "Needs an owner" and has a filter for it. The rule "at least one Owner is a Member" is gone.
- **Owners are People or typed names.** People come from the HBF Portal: everyone it lets into the board (Sunridge team and HBF team), through a new `GET /api/internal/people` call, refreshed at most every ten minutes. So the eleven Sunridge colleagues are on the board before they ever sign in. Anyone else is typed by name, up to five names. A typed name that is exactly someone on the board becomes that person.
- **A Person has signed in or not.** The board records the first sign-in. The Portal's list adds and renames people but never marks anyone signed in and never removes anyone.
- **Who may change a Task:** its Owners and Contributors, as before, and any Member when none of its Owners has signed in yet (an ownerless Task, one owned by typed names, or by colleagues who haven't signed in). The Trail records who. The Company team rules (ADR 0005) are unchanged: they change only Shared Tasks they own or contribute to.
- **Company owner:** who answers for a Task at the portfolio company, by name (the team board's "HBF owner"). It gives no access and no rights.
- **The sync never stands in.** A team board Owner the board can't place stays on the team board only. A Task the earlier sync gave to the syncing Member, and that no person has changed since, gets its Owners from the team board once. A board Owner the team board has no user for goes there by name.

## Considered options

- **Typed names only.** Simplest, but the same colleague would appear in two spellings and couldn't be matched when they sign in.
- **Invite everyone first.** Keeps the old rule, but the board would stay wrong until each of eleven people opened two tools.
- **Any Member may change any Task.** Simpler than the rule above, but it would let anyone change the work of a colleague who is actively running it.

## Consequences

- Amends ADR 0005 ("every Task keeps at least one Member as Owner") and ADR 0007 (the stand-in Owner).
- The board's app depends on portal-kit 0.2.0 (`PortalClient.listPeople`), and the Portal must be deployed first.
- New columns `vb_people.signed_in_at`, `vb_tasks.owner_names` and `vb_tasks.company_owner`; run `npm run db:init` once.
