---
status: accepted
supersedes: 0002, 0003
---

# The board runs as an HBF Portal app: portal sign-in, data in its own MySQL database on Render

The board runs like the other portal apps (decided by Arif on 14 October 2026). People sign in once through Cloudflare Access in front of the HBF Portal, and the board checks the Access token and asks the portal whether this person may use it, and as which role (`@arifsunridge/portal-kit`). The board's data lives in its own `value_board` database on the portal's Render MySQL, under its own database user.

We chose this over keeping Microsoft Lists in the Sunridge tenant (ADR 0002 and 0003) for two reasons. Managers at HBF can't sign in with Sunridge's Microsoft tenant, and the portal already signs them in. And the Lists route was still waiting on IT to grant `Sites.Selected`, with no date.

## Considered options

- **Keep Microsoft Lists, with portal sign-in.** Data stays in the tenant, but go-live still waits on IT, and the Lists limits (no transactions, weak queries) remain.
- **Rebuild the screens on the portal apps' Express and Vite stack.** Matches the other apps, but throws away working, tested screens. The board stays on Next.js and uses the kit's verifier and portal client directly.

## Consequences

- Task, Area, Document and Trail content is now stored on Render (Frankfurt), outside the Sunridge tenant. Files still live in SharePoint; the board keeps links only.
- The board writes the Trail first and the change second, as before. The database user may only INSERT and SELECT on the Trail table, so the Trail stays append-only even for the app.
- Logs carry error names and HTTP status only, as before (ADR 0002's logging rule stands).
- A Person's id is the lower-cased email the portal verified, matching the portal's "one email, one account".
- Claude access (P1.1, ADR 0004) needs `/mcp` exempted from Cloudflare Access, because Claude signs in with Entra tokens. It stays off until that is set up.
