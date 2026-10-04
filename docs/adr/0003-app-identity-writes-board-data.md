---
status: accepted
---

# The app writes board data under its own identity; Members can only read the site

All changes to the board's Lists and document library go through the app, which signs in to SharePoint with its own identity. That identity has the `Sites.Selected` application permission, granted to the board's one SharePoint site. The app records the Member behind every change in the Trail. Members can read the site but not write to it.

ADR 0002 said the app would read and write as the signed-in Member. We changed that because a Member with write access could then edit a List directly in SharePoint. That would bypass the Now cap and the title rules, and could rewrite or delete Trail entries, so the Trail could never be trusted as append-only.

## Considered options

- **Act as the signed-in Member (ADR 0002 as written).** SharePoint permissions apply naturally, but the rules and the Trail can be bypassed, and IT has to consent to broad delegated permissions such as `Sites.ReadWrite.All`.
- **Act as the Member, with SharePoint item-level locks.** Possible, but fiddly and fragile, and it still leaves the Trail open to site owners.

## Consequences

- The app is the only writer, so every rule lives once, in the app's operations. Claude (P1) authenticates as the Member to the app, never to SharePoint directly. There is still no shared account that a person or Claude can use.
- Members sign in with `User.Read` only. The app stores no Member tokens.
- The app enforces who may do what, because SharePoint no longer does it for writes. Tests must cover every permission rule.
- Reversing this later means re-granting write access to Members and accepting a Trail that can be edited.
