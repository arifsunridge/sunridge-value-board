---
name: board-update
description: Update the Sunridge team board from a chat. Use when someone says they finished, started, are blocked on or handed over a piece of work (often with a file or link attached), asks to add a Task, an Owner or a Project Update, or asks where a Project stands.
---

# Update the Sunridge team board

The team board is the Claude artifact **Sunridge team board**, `https://claude.ai/artifact/NCTE7p8t2k42ebLsPpPJ9p`. You read and write its database with `ArtifactData` and upload files with `Artifact`. An hourly sync copies every change to the Value Board app, so write to the team board only.

Every change is **proposed, then confirmed, then written**. Nothing is written until the person says yes.

## Steps

1. **Read the board.** `ArtifactData` `list` the `actions` and `groups` collections (`query.limit` 1000, `out_dir` to a scratch folder), and note each document's `version`. Read `categories` and `projects` too when you need names for places or Companies. Done when you hold every open Task and Project, with versions.
2. **Find the work.** Match what was said to one Task (by title, Project, Owner) and, for news, to its Project. When two or more fit, or none does, show the candidates and ask. Done when each change points at exactly one document id, or at a new Task you will add.
3. **Upload any file.** Upload an attached file to the board's asset store: `Artifact` `publish` with `url` set to the board, `asset: true` and `file_path`. Keep the returned asset id. It becomes a File Document (see Reference). If you can't upload from here, offer a Link Document instead, or ask the person to add the file on the board's Documents tab.
4. **Propose.** Show one short table: each document, field, old value → new value, plus the history line you will add. Typical changes:
   - Finished: `status` `done`, `doneAt` now, and the evidence as a Document linked to the Task.
   - Blocked: `status` `blocked` with `waitingOn` (one line saying who or what).
   - News on a Project: one line added to the group's `log`.
   - Owners: Sunridge people who have opened the board go in `ownerIds` (their `u_…` ids, from `valueBoardSync/config` `people` or from existing Tasks). Anyone else goes by name in `ownerNames`. Someone at HBF goes in `hbfOwner`.

   Keep titles to 8 words, starting with a verb. Keep notes to two short lines, with no money figures.
5. **Write once they agree.** Use one `ArtifactData` `batch`. Every `update` and `delete` is pinned with `if_version`. Done when the batch commits. If a version has moved on, re-read that document, show what changed, and propose again.
6. **Confirm.** Reply with what changed, in a line per document, and the board link.

## Reference

**Stamps on every write.** Set `editedAt` (ISO time now) and `editedBy` (your `u_…` id if `config.people` maps your email to one, otherwise leave it out). Add one entry to `history`, `{ at, by, text }`, keeping the last 60. History text is short and past tense, like "Moved to Done" or "Owners → Jack Tonge".

**Task (`actions`):**
- Text and state: `title`, `status` (`next` `now` `blocked` `done`), `priority` (`high` `medium` `low`), `due` (`YYYY-MM-DD` or `""`), `note`, `waitingOn`.
- Place: `projectId` (the Company: `p-hbf` or `p-claude`), `categoryId` (an Area `s-…`, or a Department `d-…`), `groupId` (the Project).
- People: `ownerIds`, `ownerNames`, `hbfOwner`.
- Stamps: `history`, `createdAt`, `createdBy`, `editedAt`, `editedBy`, `doneAt`.
- A Task is in a Project only when its `categoryId` equals the Project's `categoryId`, so set both together.
- Each Company has at most 10 Tasks in `now`; count before moving one there.
- New ids look like `t-<letters and digits>`.

**Project (`groups`):** `name`, `note` (the goal), `projectId`, `categoryId`, `ownerId` or `ownerName`, `phase` (`idea` `building` `live` `paused`), `repository`, `portalApp`, `liveUrl`, `log` (`{ at, by, text }`, append only), `history`.

**Document (`documents`):**
- Fields: `kind` (`file`, `link` or `claude`), `title`, `taskId`, `projectId`, `categoryId`, `status` (`draft` `review` `final`; evidence of finished work is `final`), `summary`, `history`, `createdAt`, `createdBy`.
- A Link or Claude work has a `url`; Claude work URLs start with `https://claude.ai/`.
- A File has `assetId`, `fileName`, `size`, `contentType` and `versions` (`[{ assetId, fileName, at, by }]`).
- New ids look like `d-<letters and digits>`.

**Sunridge team, for owner names:** Philipp Saumweber, Hugues Marchand, Michael Voice, Arnaud Goffin, Lukas Wittern, Gonzalo Líbano, Theranjit Saran, Jack Tonge, Martin Lausegger, Rachel Hong, Arif Bayrak.

**When the board app's Claude connector is connected** (tools such as `mark_done_with_evidence`, `add_project_update`, `set_task_owners`) and the team has moved off the team board, use those tools instead of `ArtifactData`, with the same propose-then-write steps. Until then the team board stays the one place you write.
