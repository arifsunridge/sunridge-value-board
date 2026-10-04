# Sunridge Value Board: spec

**Status:** draft for approval · **Author:** Arif (Analyst) · **Date:** 4 October 2026
**Read with:** [GLOSSARY.md](../GLOSSARY.md), [ADR 0001](adr/0001-sunridge-members-only.md), [ADR 0002](adr/0002-data-at-rest-inside-the-tenant.md)

## 1. Problem

The Value Creation and Investment team's work is spread across email, Teams, SharePoint, Excel and chat. Nobody has one view of what matters most, who owns it, what is blocked and which file backs it up. Partners cannot easily see whether HBF's value creation plan is being executed, and each partner update is rebuilt by hand from those scattered sources. Returns depend on executing the plan rather than on how detailed it is, so this gap goes straight to value. The Q4 window (October–December 2026) is the first test.

The prototype (a Claude artifact, backed up on 4 October) proved the shape: a board grouped by Company › Department › Area, with Next / Now / Blocked / Done. Its data also shows what to fix:

- 18 of 24 tasks scored top impact, so the score did not tell tasks apart.
- Owners were written into the titles, and the owner field was empty on 22 of 24 tasks.
- 8 tasks sat under a Department with no Area.

## 2. Goals

Each goal is measured from the Trail, so none needs manual tracking.

| # | Goal | Target | When |
|---|---|---|---|
| G1 | **Weekly use by the whole team.** Arif, Theran and Jack each change at least one Task every week. | 3 of 3, for 4 weeks in a row | Weeks 1–4 after launch |
| G2 | **Open Tasks are actionable.** Share of open Tasks with an Owner and a due date. | ≥ 90% | From week 2 |
| G3 | **Priority means something.** Share of each Company's open Tasks that are High. | ≤ 25% | Every week |
| G4 | **Faster partner update.** Time to prepare the weekly partner update, against a baseline measured before launch. | Halved in v1; under 30 minutes in v2 | Week 4 (v1); week 4 of v2 |
| G5 | **Meetings turn into Tasks.** Actions from a meeting are on the board within one working day, through Capture. | ≥ 80% of meetings with notes | Weeks 1–8 |

## 3. Non-goals

- **No access for portfolio company staff, ever** ([ADR 0001](adr/0001-sunridge-members-only.md)). Their updates reach the board through Members.
- **No file storage in the app** ([ADR 0002](adr/0002-data-at-rest-inside-the-tenant.md)). SharePoint holds files and their versions; the app holds links.
- **No scoring, effort estimates or time tracking.** The score was noise; Priority plus a due date is enough.
- **No project planning tools** (Gantt charts, dependencies between Tasks, sub-tasks). They add maintenance and nobody asked for them. A Task that needs sub-tasks is too big and should be split.
- **No replacement for Excel models, Teams chat or email.** The board points at the evidence; it doesn't become it.
- **No phone app.** The web board must work on a phone screen, and that is enough.

## 4. Users and stories

**Analyst (Arif): keeps the board true**
1. As the Analyst, I want to paste meeting notes and confirm the suggested Tasks, so that actions reach the board without retyping.
2. As the Analyst, I want to drop a file onto a Task and have it filed in the right SharePoint folder, so that the evidence is one click from the work.
3. As the Analyst, I want to see my Tasks across all Areas, whether I own them or contribute, so that I know what to do today.
4. As the Analyst, I want the board to tell me when a Task has no Owner or due date, so that I can fix gaps before the partner update.

**Senior Associate (Theran, Jack): runs the plan**
5. As a Senior Associate, I want to see each Company's Now, High and Blocked Tasks at a glance, so that I can direct the team's week.
6. As a Senior Associate, I want moving a 6th Task into Now to be refused, so that the team finishes before it starts more.
7. As a Senior Associate, I want to mark a Task Blocked with what it is waiting on, so that I know whom to chase.
8. As a Senior Associate, I want to ask Claude "what is blocked at HBF?" or "move the data pack to Done", so that I can update the board from wherever I'm working (P1).

**Partner (Hugues, Philipp): reads, doesn't maintain**
9. As a Partner, I want a summary of each Company (High and Blocked first, overdue flagged, what changed this week), so that I can judge execution in two minutes before a call.
10. As a Partner, I want to open the file behind any Task, so that I can check the evidence myself.
11. As a Partner, in v2, I want each Lever's $ value next to the Target, so that I can see whether the plan adds up to the Target.

**Edge cases the stories must cover:** a Company with no Tasks yet (empty state that invites Capture); a Member who loses access to a SharePoint file that a Document links to (the link stays, marked "you can't open this"); notes that mention no one on the team (Suggestions with no Owner, flagged); two people moving the same Task at once (the later move wins, and both moves are in the Trail).

## 5. Requirements

### P0: v1, for HBF (cannot ship without these)

**P0.1 Sign-in.** Microsoft sign-in, limited to the Sunridge tenant.
- [ ] An account from any other tenant is refused with a plain message.
- [ ] No guest or external accounts can be invited.

**P0.2 Board.** Each Company has a board grouped by Department › Area, with Next / Now / Blocked / Done in each group. Tasks with no Area sit directly under their Department.
- [ ] Drag and drop changes Status, and moves a Task between Areas within its Company.
- [ ] A Task cannot be dragged to another Company. Changing Company is an explicit edit and is logged.
- [ ] Empty Departments are collapsed by default.

**P0.3 Task.** Fields: title, Home, Status, Priority, Owners (one or more), Contributors (optional), due date (optional), note (optional).
- [ ] The title has at most 8 words. If the first word isn't a verb, the board shows a gentle prompt, not a block.
- [ ] The note has at most 2 lines (about 200 characters).
- [ ] At least one Owner is required. Owners and Contributors are picked from Members, never typed into the title.
- [ ] A Task with no due date shows a quiet "no date" marker.

**P0.4 Now cap.** At most 5 Tasks in Now per Company.
- [ ] Moving a 6th Task into Now is refused: "HBF already has 5 Tasks in Now. Move one out first."
- [ ] The cap counts Tasks, not people. One person may own several Tasks in Now.

**P0.5 Priority.** High / Medium / Low, decided by the one-week slip test (see Glossary).
- [ ] When choosing a Priority, the one-line rule is shown next to the choice.
- [ ] If more than 25% of a Company's open Tasks are High, a banner says so. Nothing is blocked.

**P0.6 Blocked.** Moving a Task to Blocked asks "Waiting on?", answered in one line that becomes the note.
- [ ] A Blocked Task always shows what it is waiting on.

**P0.7 Documents.** A Document is a File, a SharePoint or web Link, or Claude work. It has a status (Draft, In review or Final) and supports exactly one Task.
- [ ] Dropping a file uploads it to the Company's SharePoint library, in a folder for the Task's Area, signed in as the Member. The app keeps only the link and metadata.
- [ ] Replacing a File adds a Version in SharePoint. The Document stays the same and the Trail records it.
- [ ] Moving a Document to another Task is logged on both Tasks.
- [ ] Removing a Document takes it off the Task and keeps its name, last link, who and when in the Trail, and it can be restored. The app never deletes a SharePoint file.

**P0.8 Trail.** Every create, change, move, remove and restore on a Task or Document is recorded: who, what, old and new value, and when.
- [ ] The Trail is append-only. There is no edit or delete, even for Senior Associates.
- [ ] The Trail is collapsed by default and opened from the Task.

**P0.9 Remove and restore Tasks.** Removing a Task hides it from the board and keeps its Trail and Documents. A Member can restore it.

**P0.10 Capture.** A Member pastes meeting notes for a Company, and Claude returns Suggestions. Each one has a title (at most 8 words, starting with a verb), a Home, Priority, Owners and a due date if the notes give one.
- [ ] Nothing reaches the board until a Member confirms each Suggestion. The Member can edit or discard any of them.
- [ ] Suggestions follow the Glossary rules: Owners are Members only, with no names in titles. Suggestions for HBF content use US English.
- [ ] The pasted notes are not stored. Each confirmed Task's Trail records "from notes of [date], confirmed by [Member]".

**P0.11 Views.** "My Tasks" (Owner or Contributor, across Companies). Filters: High, Blocked, Overdue, No owner or no date.
- [ ] A **Summary** view per Company for Partners: High and Blocked first, overdue flagged, a list of what changed in the last 7 days, and everything else collapsed.

**P0.12 Areas.** Any Member can add, rename or retire an Area for a Company. Retiring an Area that still has open Tasks asks where to move them.

**P0.13 Confidentiality** ([ADR 0002](adr/0002-data-at-rest-inside-the-tenant.md)).
- [ ] No Task, Document or Trail content is stored outside the Sunridge tenant, including in application logs.
- [ ] No real HBF figures appear in seed data, examples or tests. No secrets are in code.

**P0.14 Prototype import.** A one-off import of the 4 October backup. Titles are cut to 8 words, owner names are moved out of titles into Owners, and Levers and Workstreams are dropped. Arif reviews every imported Task before it shows.

### P1: soon after v1 (design for these now)

**P1.1 Claude reads and updates the board.** From Claude chat or Claude Code, a Member can list, search and read Tasks. They can also create, update (Status, Priority, Owners, due date, note), remove and restore Tasks, and add Document links.
- [ ] Claude acts as the signed-in Member, with exactly that Member's permissions. There is no shared service account.
- [ ] Every change made through Claude appears in the Trail as "[Member] via Claude".
- [ ] The same rules apply as on screen: the Now cap, the title length and at least one Owner.
- *Design now:* every board action goes through one set of named operations, which the screen and Claude both use. That way, adding Claude doesn't mean a second set of business rules.

**P1.2 "This week" digest.** A Summary of what moved to Done, what became Blocked and what went overdue. Copy-ready for the partner update.

**P1.3 Quick add.** Add a Task with the keyboard from anywhere on the board (title, then Enter), filling in the Home from the current view.

### P2: later (do not design out)

- **v2 Targets and Levers.** A Company has Targets (baseline, target, date). A Lever adds $ per month towards one Target, and a Task supports at most one Lever. The Summary shows the Target, the sum of Levers and the gap. *Design now:* a Task can take an optional Lever reference without changing anything else.
- **v2 Partner update drafted from the board.** Claude drafts the weekly update from the Summary, the digest and the Levers, and a Senior Associate edits and sends it.
- **v3 More Companies and Sunridge's internal work.** These need no new concepts: a Company is already "a portfolio company or Sunridge".
- **v3 Deal work.** A deal is a Company still being assessed. Deal Companies are visible only to the Members named on them. *Design now:* access is checked per Company, even though in v1 every Member can see every Company.
- **v3 Outlook and Teams.** An email or Teams message is a Document of kind Link, and a Teams meeting transcript can be fed into Capture.
- **Parked:** Goal, Meeting, Decision, Feedback (private to the person who received it).

## 6. Experience

**House style.** White background; olive #61664E and #535349 for structure; sage #DDE5DC for group headers; ink #2D2D2D for text, grey #6F6F6F for secondary text. Gold #D8A45F is for accents only. Libre Baskerville for titles, Figtree for everything else. Square corners, no shadows, no gradients.

**A card shows four things:** a priority bar on the left edge (High #B5543C, Medium #D8A45F, Low #ABBEA9), the title, the Owners' initials and the due date. A small mark appears when the Task has Documents. A Blocked card also shows its "waiting on" line. There are no numbers, scores or counts on cards. Everything else (note, Contributors, Documents, Trail) opens from the card and is collapsed by default.

**Language.** Plain English, no abbreviations, no internal tool names. "Now", not "WIP". "Waiting on", not "dependency". Sunridge screens use British English; HBF content uses US English. Interface words match the Glossary exactly.

**Lean test for every field:** if removing it wouldn't change a decision someone makes from the board, it goes, or it stays collapsed.

## 7. Success metrics

| Type | Metric | Success | Stretch | Source |
|---|---|---|---|---|
| Leading | Members making at least one change a week | 3/3 | 3/3 plus Partners opening the Summary weekly | Trail |
| Leading | Confirmed Suggestions per Capture | ≥ 60% confirmed | ≥ 80% confirmed with no edits | Trail |
| Leading | Open Tasks with an Owner and due date | ≥ 90% | 100% | Board |
| Leading | High share of open Tasks per Company | ≤ 25% | ≤ 20% | Board |
| Lagging | Time to prepare the partner update | −50% against baseline | under 30 minutes (v2) | Self-timed by Senior Associates for 4 weeks |
| Lagging | Partner confidence: "I know what's blocked at HBF without asking" | 2 of 2 Partners say yes at the week-8 review | | Ask them |
| Lagging | Tasks reaching Done before their due date | Upward trend Oct → Dec | | Trail |

We review at weeks 4 and 8 after launch, and at the Q4 close in January 2027.

## 8. Open questions

| # | Question | Who answers | Blocking? |
|---|---|---|---|
| Q1 | Can portfolio company content be sent to Claude for Capture and P1 under Sunridge's current Claude agreement and data policy? | Partners, Sunridge IT | **Yes**, for P0.10 |
| Q2 | Will IT grant the app delegated access to one SharePoint site only, for Lists and the document library? | Sunridge IT | **Yes**, for build |
| Q3 | Which SharePoint site and library hold HBF Documents, and do we file by Area folder or a flat folder? | Theran | Yes, for P0.7 |
| Q4 | How does the HBF Portal handle sign-in on Render? Does the board use the Portal's sign-in or its own? | Theran | Yes, for build |
| Q5 | How long does the partner update take today? We need a baseline for G4. | Theran, Jack | No; measure before launch |
| Q6 | Gold is "accent only" but also means Medium priority. Against white, sage (Low) is 2.0:1 and gold (Medium) is 2.2:1, both below the 3:1 contrast that WCAG requires for interface marks. Do we change colours, or add a text label for screen readers and keep them? | Arif (design) | No |
| Q7 | The design tokens folder (context/tokens/) wasn't supplied to this session. Are there tokens beyond the brief's palette and fonts? | Arif | No |
| Q8 | How long do Done Tasks stay visible on the board before they collapse into "Done earlier"? | Arif | No |
| Q9 | Should Trails follow a Microsoft 365 retention policy (kept for N years), or be kept forever? | Sunridge IT, Partners | No |

## 9. Phasing

| Version | Scope | Aim |
|---|---|---|
| **v1** | HBF and Sunridge as Companies. Tasks, Documents, Trail, Capture, Summary, prototype import (P0). Claude access (P1.1) and the digest (P1.2) as fast follows. | Live early November 2026, so the board covers most of the Q4 window. |
| **v2** | Targets and Levers with $ per month. The partner update drafted from the board. | December 2026, in time for the Q4 close review. |
| **v3** | More portfolio companies, deal work with access per Company, Outlook and Teams links. | Q1 2027. |

**Dependencies:** Q1–Q4 above. The Render-hosted HBF Portal (Theran). Sunridge IT approval for SharePoint access.

**Next step after approval:** a short tech-stack proposal that follows ADR 0002, then build v1.
