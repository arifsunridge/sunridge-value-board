---
status: accepted
amended_by: 0008, 0009, 0010
---

# The board and the team board artifact stay in sync both ways, through a scheduled Claude routine

The team keeps using the "Sunridge team board" Claude artifact while the board is live, and the two stay in sync both ways (decided by Arif on 15 October 2026), instead of a one-time move.

Only a Claude session acting as Arif can read and write the artifact's database. So a Claude routine runs every hour. It reads the artifact's `actions`, `categories`, `documents` and `valueBoardSync` collections, posts them to the board's `/api/sync` with a shared secret (`SYNC_TOKEN`), and writes back into the artifact the changes the board returns. The comparison and every board change happen in the board (`src/sync/`), through `Board`, so the board's rules apply.

## How the two sides match

- A Task that came from the team board has `Team board (id)` as the source in its first Trail entry. A Task added on the board goes to the artifact as `vb-<task id>`. No new column is needed.
- Both sides are compared in the board's terms, after a round trip, so something only one side can hold never counts as a change. Examples are a ninth word in a title, a third line in a note, or an Owner the artifact doesn't know.
- Where they differ, the side changed more recently wins, for the whole Task: the artifact's `editedAt` against the board's `updatedAt`. If the same Task changes on both sides within an hour, the later change wins and the earlier one is lost.
- Synced: title, Status (with Waiting on), Priority, Owners, due date, note, Department and Area, removed. Documents come across once, when a Task is first added to the board. Contributors and Shared stay board-only, and Private Tasks never go to the team board (ADR 0010). A Task can't change Company through the sync.
- A team board Task with no Owner the board knows comes in with the Owners it can place, or none (ADR 0009; it used to be owned by the syncing Member). A Task over the Now cap comes in as Next.
- Projects (the artifact's `groups`), a Task's Project, Owners typed by name and the company owner (`hbfOwner`) are synced too (ADR 0008, 0009).

## Considered options

- **One-way, team board to board.** Simpler and needs no way into the board, but board edits would be overwritten. Arif chose both ways.
- **A Cloudflare Access service token in front of `/api/sync`.** It would be stronger, but it needs Access policy changes and the board's own address allowed for Claude's cloud sessions. For now the routine calls the Render address with the secret. A service token can be added later without changing the sync.

## Consequences

- `/api/sync` is off unless `SYNC_TOKEN` (at least 32 characters) and `SYNC_AS_EMAIL` are set. Anyone with the secret can read every Task the syncing Member can see and change them as that Member. Keep it in Render's and the routine environment's secrets only, and rotate it if it leaks.
- The sync acts as a Member, on the Trail as "sync". It may change a Task without joining it first. Any Member can join any Task, so this widens nothing. The Trail shows "from the team board".
- Task content travels only in the sync's request and response, never in logs (ADR 0002).
- The routine's environment must allow `sunridge-value-board.onrender.com`, and hold `SYNC_TOKEN` as a secret.
