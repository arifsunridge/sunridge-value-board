# Setting up the board

Steps that need Sunridge IT (Microsoft 365 admin) are marked **IT**. Nothing here goes in the repo: certificates, secrets and IDs live in Render's environment settings.

## 1. SharePoint site (IT)

1. Create a private SharePoint site for the board, for example "Value Board". Owners: IT only.
2. Give the Value Creation and Investment team **Read** access to the site. They open files and can see the Lists, but every change goes through the app (ADR 0003).
3. Note the site ID: `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}` → `id`.

## 2. App registration (IT)

1. Microsoft Entra ID → App registrations → New. Name: "Sunridge Value Board". **Single tenant** (ADR 0001).
2. Redirect URI (Web): `https://<board address>/auth/callback`.
3. Enterprise application → Properties → **Assignment required: Yes**, then assign the team (Analyst, Senior Associates, Partners). Nobody else can sign in.
4. Delegated permission: `User.Read` only.
5. Application permission: `Sites.Selected`, with admin consent.
6. Grant the app **write** on the board site only:
   `POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions` with
   `{ "roles": ["write"], "grantedToIdentities": [{ "application": { "id": "<client id>", "displayName": "Sunridge Value Board" } }] }`.
   (Use `manage` for the first run of the provisioning script, which creates Lists, then reduce to `write`.)
7. Certificates & secrets:
   - Upload a certificate for the app identity. Keep the private key out of email and chat.
   - Add a client secret for sign-in (24-month expiry, with a calendar reminder to rotate).

## 3. Lists and companies

```
cp .env.example .env    # fill in ENTRA_*, SHAREPOINT_SITE_ID; STORE=lists
npm run provision -- --company "HBF:portfolio:US" --company "Sunridge:sunridge:UK"
```

## 4. Render

1. New → Blueprint → this repository. `render.yaml` creates the service in Frankfurt.
2. Fill in the `sync: false` values in the dashboard. Paste the certificate's private key into `ENTRA_CERT_PRIVATE_KEY`.
3. Set `APP_BASE_URL` to the service address (or the HBF Portal path, once spec question Q4 is settled).

## 5. Prototype import (once)

Keep the backup and review file in `private/` (git-ignored).

```
npm run import -- prepare private/team-board-backup.json --members private/members.json --out private/review.json
# Review every item: fix titles, Owners and Priority; set "approved": true
npm run import -- apply private/review.json --as <your member id>
```

`members.json` maps first names (and the prototype's user IDs) to Members' Entra object IDs. Members appear in the "Board Members" list after their first sign-in.

## 6. Capture

Leave `CAPTURE_ENABLED=false` until Partners and IT answer spec question Q1. Then set `ANTHROPIC_API_KEY` and `CAPTURE_ENABLED=true`.

## 7. Claude access (P1)

Lets Members read and change the board from Claude chat or Claude Code, as themselves, under the same rules as the screen ([ADR 0004](adr/0004-claude-endpoint-address-is-the-app-id.md)). Leave `CLAUDE_ACCESS_ENABLED=false` until spec question Q1 is answered.

**Domain (IT).** Give the board a custom domain verified in Microsoft 365, for example `board.sunridgepartners.com`, and add it to the Render service. Set `APP_BASE_URL` to it.

**The board's app registration (IT).**

1. Expose an API → Application ID URI: `https://<board domain>/mcp`. It must match exactly, with no trailing slash.
2. Add a scope: `Board.ReadWrite`, "Read and change the Value Board as you". Who can consent: admins and users.
3. Manifest: set `requestedAccessTokenVersion` (shown as `accessTokenAcceptedVersion` in older manifests) to `2`.

**A client app for Claude (IT).** Register a second app, "Sunridge Value Board for Claude", single tenant:

1. API permissions: the board's `Board.ReadWrite`, with admin consent.
2. Web redirect URI `https://claude.ai/api/mcp/auth_callback`, plus a client secret for claude.ai.
3. Mobile and desktop redirect URIs `http://localhost/callback` and `http://127.0.0.1/callback` for Claude Code. Allow public client flows, so Claude Code needs no secret.

**claude.ai (an Owner of Sunridge's Claude organisation).** Organization settings → Connectors → Add custom connector. URL: `https://<board domain>/mcp`. Advanced settings → use your own OAuth client: the Claude client app's ID and secret.

**Claude Code (each Member).**

```
claude mcp add --transport http --client-id <Claude client app ID> --callback-port 8765 \
  sunridge-board https://<board domain>/mcp
```

Then run `/mcp` in Claude Code to sign in with your Microsoft account.

**Trying it locally.** With `AUTH_MODE=dev` and `CLAUDE_ACCESS_ENABLED=true` in `.env`:

```
claude mcp add --transport http --header "Authorization: Bearer dev:m-theran" sunridge-board-local http://localhost:3000/mcp
```
