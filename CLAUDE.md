@AGENTS.md

# Sunridge Value Board

Read `GLOSSARY.md` before naming anything; use its words in code and on screen. Decisions that are hard to reverse are in `docs/adr/`; the approved scope is `docs/spec.md`.

## Rules that matter here

- Every rule (Now cap, title length, Owners, Blocked "waiting on", who may edit) lives once, in `src/board/board.ts`. Screens, Capture, the import and Claude call `Board`; never write to a `Store` directly.
- The Trail is append-only. Don't add update or delete for it.
- Nothing about Tasks, notes or meeting notes goes in logs: error names and HTTP status only (ADR 0002).
- No real portfolio company figures, names or files in the repo, seeds or tests. Use invented, rounded examples.
- Interface text: plain British English, no abbreviations. HBF content is US English.
- House style: tokens in `src/app/globals.css`. Square corners, no shadows or gradients, gold as accent only.

## Checks

`npm run check` (typecheck, lint, tests). Run `npm run dev` with `.env` copied from `.env.example` to use the in-memory store and local sign-in.
