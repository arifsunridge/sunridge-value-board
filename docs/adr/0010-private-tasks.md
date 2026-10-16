---
status: accepted
amends: 0005, 0007
---

# A Member can make a Task Private, so only its Owners and Contributors see it

Every Member saw every Task of every Company. Arif asked on 16 October 2026 for Tasks that are personal: some of his own work is for him, not for everyone, and he didn't want all of it on show to colleagues. These Tasks should still appear in My Tasks the way other Tasks do, with a lock.

## Decisions

- **Private** is a yes-or-no on a Task, off unless a Member turns it on. A Private Task is seen only by its Owners and Contributors on the board. Anyone else, Members included, gets "not found", so they can't tell it exists. That applies on the board, the Summary, Projects, removed Tasks, My Tasks, Claude and the sync.
- **Who sees it is who is on it.** No separate list of viewers. Adding someone as an Owner or Contributor lets them see it; taking them off hides it again.
- **It never disappears for everyone.** Whoever adds a Private Task, or makes a Task Private, must be an Owner or Contributor of it. A Private Task must keep at least one Owner or Contributor on the board. An Owner typed by name doesn't count, because they can't see it.
- **Private is never Shared.** A Shared Task must stop being shared before it can be made Private, and a Private Task must be opened to Sunridge before it can be Shared. So a Company team never sees a Private Task.
- **Nobody joins their way in.** "Join as a Contributor" works only on a Task you can already see.
- **Private Tasks don't count towards Now.** Each Company still has at most ten Tasks in Now, not counting Private ones. Otherwise a colleague could be refused a place by a Task they can't see or move. Opening a Private Task that is in Now needs a free place.
- **The sync leaves Private Tasks on the board.** They never go to the team board, even the syncing Member's own. A Task that reached the team board before it was made Private is marked removed there, and nothing from the team board changes it. Opening it again puts it back on the team board. The board gives the sync the ids of every Private Task, and only the ids, so this works even when the syncing Member isn't on the Task.
- **The Summary lists them apart.** "Your Private Tasks" is its own section, for the people on them only, and Private Tasks are left out of Needs attention, Late, Changed and the rest, so those read the same for every Member.
- Making a Task Private, or opening it, is on its Trail. Only the Task's people can read that Trail.

## Considered options

- **Visible to its creator only.** Simplest to explain, but personal work often has a colleague helping on it, and handing it over would mean opening it up first.
- **A separate personal board outside the Companies.** Clearer, but Private work still belongs to a Company and Department. A separate board would also have needed a second set of views and rules.
- **Hide Private Tasks from other Members' screens but keep them in the Summary.** Partners would still see the titles, which is the leak Arif wanted to avoid.

## Consequences

- Amends ADR 0005: "Members see every Task" now means every Task except other people's Private ones. The Company team rules are unchanged.
- Amends ADR 0007: Private Tasks are left out of the sync both ways.
- A Private Task's text is at rest in the same database as every other Task. Private hides it on screen, not from someone with database access.
- New column `vb_tasks.is_private`. The app adds it on start where its login may ALTER; otherwise run `npm run db:init` once.
