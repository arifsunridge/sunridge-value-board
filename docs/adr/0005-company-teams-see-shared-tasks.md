---
status: accepted
supersedes: 0001
amended_by: 0009
---

# Company teams see only Shared Tasks, and update the ones they own

People at a portfolio company (the Company team, such as the HBF team) can sign in to the board through the HBF Portal (decided by Arif on 14 October 2026, after Jack asked to give HBF's CEO access). The Company team sees only their own Company's Tasks that a Member has marked Shared. Tasks in Talent & organisation and Finance can never be Shared. Someone in the Company team can own or contribute to a Shared Task, and on those Tasks can change the Status, title, due date and note, add Links and keep their Documents up to date (Files and Claude work are added by Members). Priority, Owners, Contributors, the Home and Shared stay with Members. (ADR 0009 dropped "every Task keeps at least one Member as Owner".)

This replaces ADR 0001 ("only Sunridge staff can ever sign in"). Its reason still holds: the board carries people, financing and exit work that company staff must never see. So sharing is per Task, off by default, and impossible for the two Departments where that work lives.

## Considered options

- **Share whole Departments.** Simpler to run, but one sensitive Task filed in a shared Department would leak.
- **Show the Company team everything for their Company.** Fully reverses ADR 0001. One misplaced Task would expose exit or people work.
- **A weekly PDF instead of access.** No access risk, but stale, and the Company team couldn't update their own Tasks.

## Consequences

- The portal fixes the role by audience in code: Sunridge people get the role **Sunridge team** (Members) and HBF people get **HBF team** (`AUDIENCE_ROLES` in `hbf-portal`). The board also reads the audience itself, so a wrong role in App settings can't turn someone from HBF into a Member.
- Every read in `board/` filters by the Person asking. A Task that isn't visible to the Company team answers "not found", so its existence isn't revealed.
- Stopping sharing takes the Company team off the Task's Owners and Contributors. A Shared Task can't move to another Company or into Talent & organisation or Finance until a Member stops sharing it.
- The Now cap still counts every Task, so someone in the Company team can be refused a Task in Now without seeing every Task already there.
- A Shared Task's Trail is visible to the Company team, including changes made before it was Shared.
- Capture, Areas, removing and restoring Tasks, and Claude access stay Member-only.
