# Setting up the board

The board runs as an HBF Portal app (ADR 0006): sign-in through Cloudflare Access, access and role from the portal, data in its own `value_board` database on the portal's Render MySQL. Nothing here goes in the repo: passwords, tokens and IDs live in Render's environment settings.

Steps marked **Arif** need the Cloudflare, Render or portal admin accounts.

## 1. Database (Arif)

On `hbf-mysql`, the Render MySQL that holds the portal's database (never the live HBF database; the board refuses `hbroch.com` hosts). Render's private network is per region, so the board runs in **Oregon**, like `hbf-mysql`.

Easiest, once the Render service exists (section 3): add a temporary variable `DB_ADMIN_PASSWORD` to the service (the value of `MYSQL_ROOT_PASSWORD` on `hbf-mysql`), then in Render → `sunridge-value-board` → Jobs, run:

```
DB_APP_PASSWORD="$DB_PASSWORD" DB_USER=root DB_PASSWORD="$DB_ADMIN_PASSWORD" npm run db:init
```

It creates the `value_board` database and tables and the board's own login `value_board` with the password already in the service's `DB_PASSWORD` (at least 24 characters). Then delete `DB_ADMIN_PASSWORD` from the service and redeploy. Running it again is safe.

The board's login can add to the Trail but never change or delete it. That is what keeps the Trail append-only (ADR 0006). Without `DB_APP_PASSWORD`, `db:init` prints the `CREATE USER` and `GRANT` statements instead.

## 2. Portal (Arif, as portal admin)

The portal change that goes with this board (`hbf-portal`, branch `claude/vibrant-lovelace-ldsqt4`) fixes the Value Board's roles by audience: Sunridge people are **Sunridge team**, HBF people are **HBF team**. After it is deployed:

1. **App settings → Value Board:** tick both the `sunridge` and `hbf` audiences, set the roles to `Sunridge team, HBF team`, and set the address to `https://hbf-value-board.sunridge.app`. The portal only adds an app's row when it is missing, so this edit is needed once.
2. **People & access:** give each Sunridge person the Value Board as **Sunridge team**. Existing Value Board grants have no role and stop working until they are given one.
3. When Sunridge is ready, give the HBF people who should see it (for example HBF's CEO) the Value Board as **HBF team**. They see nothing until a Member shares Tasks with them.

## 3. Render and Cloudflare (Arif)

1. Render: New → Web Service from this repository (region Oregon), or a Blueprint with `render.yaml`. Fill in the `sync: false` values:
   - `DB_HOST`: the same as Materials Planning's. `DB_PASSWORD`: a new random password of at least 24 characters, used by section 1.
   - `PORTAL_INTERNAL_URL`, `PORTAL_SERVICE_TOKEN`: the same as the other portal apps.
   - `CF_ACCESS_TEAM_DOMAIN`: `sunridgeportal.cloudflareaccess.com`.
   - `CF_ACCESS_AUD`: from step 3 below.
2. Cloudflare DNS: `hbf-value-board.sunridge.app` → the Render service, proxied, and add it as a custom domain in Render.
3. Cloudflare Zero Trust: a self-hosted Access application for `hbf-value-board.sunridge.app`, with the same policies as the other HBF apps (Sunridge by Microsoft, `@hbroch.com` by email code). Copy its AUD tag into `CF_ACCESS_AUD`.
4. Run the portal's go-live checklist (`hbf-portal/docs/security.md`). In particular, check that the `onrender.com` address answers "Open the board from the HBF Portal" with no token.

The board refuses to start in production without the portal and database settings. A person the portal hasn't granted the Value Board sees a no-access page with a link back to the portal.

## 4. Moving the team board across

The team works today in the "Sunridge team board" Claude artifact. Move it across once the board is live, then stop editing the artifact, so there's one board:

1. Export the artifact's database (the `projects`, `categories`, `actions` and `documents` collections, one JSON file per document, one folder per collection) into `private/team-board/` (git-ignored).
2. Write `private/team-board.json`: `{ "people": { "u_…": "<email>" }, "guessed": [], "companies": { "p-hbf": "HBF", … } }`, mapping the artifact's user ids to people's emails and its projects to the board's companies.
3. `npm run import -- prepare-team-board private/team-board --config private/team-board.json --out private/review.json`
4. Everyone named as an Owner signs in to the board once, so the board knows them.
5. On the board, **Import** (Members only): upload `review.json`, check every row, choose an Owner where there is none, untick what you don't want, and import. Tasks come in as you, with their Status, Documents and Priority, and are not Shared. A company's Now holds 10: the rest come in as Next, and the screen says which. Running it again adds nothing already on the board.

The older prototype backup is prepared with `npm run import -- prepare` instead, and imports the same way.

## 5. Capture

Leave `CAPTURE_ENABLED=false` until Partners and IT answer spec question Q1. Then set `ANTHROPIC_API_KEY` and `CAPTURE_ENABLED=true`. Capture is for Members only.

## 6. Claude access (P1)

Lets Members read and change the board from Claude chat or Claude Code, as themselves, under the same rules as the screen ([ADR 0004](adr/0004-claude-endpoint-address-is-the-app-id.md)). The HBF team can't use it. Leave `CLAUDE_ACCESS_ENABLED=false` until spec question Q1 is answered, and until:

1. Cloudflare Access exempts `/mcp` and `/.well-known/oauth-protected-resource/mcp` (a Bypass policy for those paths only). Claude signs in with Entra tokens, which the board checks itself; it can't pass Cloudflare's login.
2. The board's app registration exposes `https://hbf-value-board.sunridge.app/mcp` as its Application ID URI, with the `Board.ReadWrite` scope, and a client app for Claude is registered (ADR 0004). Set `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID`.

Claude identifies a Member by the email in their Entra token, which matches their portal sign-in.

**Trying it locally.** With `AUTH_MODE=dev` and `CLAUDE_ACCESS_ENABLED=true` in `.env`:

```
claude mcp add --transport http --header "Authorization: Bearer dev:m-theran" sunridge-board-local http://localhost:3000/mcp
```

## Local work

```
cp .env.example .env   # set SESSION_SECRET; AUTH_MODE=dev and STORE=memory need nothing else
npm install
npm run dev            # http://localhost:3000: choose a Member, or "Jordan Example (HBF team)" to see what the HBF team sees
```

To run the store checks on MySQL as well, point `TEST_DB_HOST` (and `TEST_DB_USER`, `TEST_DB_PASSWORD`, `TEST_DB_NAME`) at a throwaway database and run `npm test`. The tests drop and recreate the board's tables there.
