# Sunridge Value Board: tech stack proposal

**Status:** proposed · **Date:** 4 October 2026 · **Follows:** [spec](spec.md), [ADR 0001](adr/0001-sunridge-members-only.md), [ADR 0002](adr/0002-data-at-rest-inside-the-tenant.md), [ADR 0003](adr/0003-app-identity-writes-board-data.md) (new)

## In one paragraph

The board is one TypeScript web app (Next.js) running on Render, next to the HBF Portal. Members sign in with Microsoft, and only Sunridge accounts are accepted. The app stores nothing of its own. Tasks, Areas, Documents and Trail entries live in Microsoft Lists on one Sunridge SharePoint site, and files live in that site's document library. The app reaches that site through Microsoft Graph under its own identity, which IT limits to that one site. It records which Member did what. Capture calls the Claude API. In P1, the same set of board operations is exposed to Claude through an endpoint that uses the Model Context Protocol (MCP). Running cost is about £10–15 a month.

## The pieces

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, end to end | One language for screen, server and Claude tools. Theran's Render apps can share code. |
| Web framework | Next.js, served by one Render web service | Screen and server live in one deployable, so there is one thing to host. It fits beside or inside the HBF Portal (see Q4 below). |
| Drag and drop | dnd-kit | Accessible (keyboard drag), small, and well maintained. |
| Sign-in | Microsoft Entra ID, single-tenant app registration, sign-in code flow via MSAL Node | Only Sunridge accounts can sign in (ADR 0001). The only delegated permission is `User.Read`. |
| Session | Encrypted, http-only cookie holding the Member's ID and name | No refresh tokens to store, because the app never calls Graph as the Member. Nothing is held at rest on Render. |
| Board data | Microsoft Lists on a dedicated SharePoint site: Companies, Areas, Tasks, Documents, Trail | Inside the tenant (ADR 0002). Departments are fixed in code, because they are the same for every Company. |
| Files | That site's document library, one folder per Company and Area | Versions, retention and sharing come from SharePoint. The app keeps the link and the item ID. |
| Access to SharePoint | App identity with the `Sites.Selected` application permission, granted to this one site, authenticated by certificate | Members can't edit the Lists directly, so the rules and the append-only Trail hold (ADR 0003). One narrow permission for IT to approve. |
| Capture | Claude API, `claude-opus-5-5`, structured output against the Suggestion schema, server-side fallbacks on | Turns notes into validated JSON in one call. The notes go in the request and are never written down. |
| Claude access (P1) | An MCP endpoint (`/mcp`) inside the same app, with Members signing in through Entra | Claude chat and Claude Code use the same operations as the screen. |
| Hosting | Render web service in Frankfurt, Starter plan to begin | Theran already runs apps on Render. Frankfurt is the closest region to London. |
| Fonts | Libre Baskerville and Figtree, bundled at build time | No calls to Google at runtime. |
| Tests | Vitest for rules, Playwright for the board, and an in-memory store for both | Tests never touch SharePoint or real data. |
| CI | GitHub Actions: typecheck, lint, tests; secret scanning on | Matches the "no secrets in code" rule. |

## How the code is shaped

```
app/            screens and server actions (thin)
board/          the operations: createTask, moveTask, addDocument, removeTask, …
                enforces every rule (Now cap, title ≤ 8 words, ≥ 1 Owner)
                and writes the Trail for every change
store/          one interface, two adapters: Lists (Graph) and in-memory (tests, local dev)
capture/        notes → Suggestions (Claude API); confirming calls board.createTask
mcp/            P1: exposes board operations as tools, unchanged
```

The rules exist once, in `board/`. The screen, Capture and Claude all call the same operations, so P1.1 ("the same rules apply as on screen") holds by construction.

## Data in Microsoft Lists

| List | Key columns (indexed where filtered) |
|---|---|
| Companies | Name, Kind (portfolio / Sunridge / deal later), Language (US / UK English) |
| Areas | Company, Department, Name, Retired |
| Tasks | Company, Department, Area, Title, Status, Priority, Owners, Contributors, Due, Note, Removed, Lever (empty until v2) |
| Documents | Task, Kind (File / Link / Claude work), Status, SharePoint item ID or URL, Removed |
| Trail | Subject (Task or Document ID), Member, Action, Field, Old, New, Via (screen / Capture / Claude), When |

**Limits we design around.** A List can hold millions of items, but a filter beyond 5,000 items needs an indexed column. The Trail is the only List likely to pass 5,000 within a year, so Subject and When are indexed from day one. v2 adds Targets and Levers Lists; nothing existing changes.

**No transactions.** Lists can't update a Task and write its Trail entry atomically. The board writes the Trail entry first, then the change. If the change fails, it writes a "failed" entry. Two people moving the sixth Task into Now in the same second could briefly exceed the cap. The board re-checks after writing and moves the later one back. At three Members, this is acceptable.

## Security and confidentiality

- **Nothing at rest outside the tenant.** Render runs code. Logs carry IDs and timings only, never titles, notes or names. A test fails the build if a log line includes Task fields.
- **Least privilege.** For Members, the app asks only to sign them in. The app's own access is one SharePoint site, granted by IT through `Sites.Selected`, with no other Graph permissions.
- **Secrets.** The Entra client ID, the certificate and the Anthropic API key are Render environment secrets. None are in the repo, and the CI secret scan blocks any that slip in.
- **Members can read but not write the site.** They can open files and see the Lists in SharePoint, but every change goes through the app. That is what makes the Trail trustworthy.
- **Claude.** Capture and P1 send content to Anthropic's API. Whether that's allowed is spec question Q1 (Partners and IT). Capture is built behind a switch, so v1 can ship with Capture off if the answer is late.

## Running cost (monthly, rough)

| Item | Cost |
|---|---|
| Render web service (Starter), production | about $7 |
| Render test service (free tier, sleeps when idle) | $0 |
| Claude API for Capture (about 100 Captures of 6,000 tokens in and 2,000 out, at $4 / $20 per million) | about $6 |
| SharePoint, Lists, Entra | $0 extra (existing licences) |
| **Total** | **about $13 (≈ £10–15)** |

Claude access through MCP (P1) runs on the Member's own Claude plan and adds no API cost.

## Environments

- **Local:** in-memory store with illustrative seed data (rounded numbers, invented names).
- **Test:** its own SharePoint site and app registration, with illustrative data only. Used for every pull request preview.
- **Production:** the Sunridge site. Data from the prototype import arrives only through P0.14, after Arif reviews it.

## Risks and how we cover them

| Risk | Cover |
|---|---|
| IT won't grant `Sites.Selected` quickly (spec Q2) | Ask in week 1. Build against the in-memory store until it is granted. |
| The HBF Portal uses a different stack or sign-in (spec Q4) | The board is one service with its own sign-in. The Portal links to it, or embeds it under a path. Settle with Theran before the build starts. |
| Graph throttling or slow List reads | Read each board in one filtered query and cache it per request. At our volume this is far below Microsoft's limits. |
| Connecting Claude to an Entra-protected MCP endpoint needs a manual setup step for the client | A half-day spike at the start of P1. If it is awkward in Claude chat, ship Claude Code first. |

## Decisions needed from you

1. **Approve ADR 0003.** The app writes with its own identity and Members get read-only access to the Lists. This changes one line of ADR 0002 ("reads and writes as the signed-in Member").
2. **Confirm the Portal fit with Theran** (spec Q4): a separate Render service the Portal links to, or a route inside the Portal's app.
3. **Approve the Capture model** (`claude-opus-5-5`, about $6 a month). A cheaper model would save a few dollars a month at the cost of weaker Suggestions.

Once these are agreed, v1 build starts with `board/` and the in-memory store, then sign-in, then the Lists adapter.
