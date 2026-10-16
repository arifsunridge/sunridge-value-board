# Sunridge Value Board

The shared language of the Value Creation and Investment team for tracking whether each portfolio company's value creation plan is being executed.

## Where work lives

**Company**:
A business whose work is tracked on the board: a portfolio company, or Sunridge itself for internal work.
_Avoid_: portco, client, entity

**Department**:
One of six standard functions shared by every Company: Strategic planning, Sales & distribution, Operations, Talent & organisation, Innovation & efficiency, Finance.
_Avoid_: Category, function, pillar

**Area**:
A named slice of one Department inside one Company, such as HBF › Operations › Manufacturing.
_Avoid_: Sub-category, sub-department, team, stream

**Home**:
The single Company and Department a Task or Project belongs to, plus at most one Area. Work that spans two Areas lives in the Area that owns the result. Work that spans Companies becomes one Sunridge Task or one Task per Company.
_Avoid_: Location, bucket, parent

**Project**:
A named piece of work in one Home, with a goal, one Owner and a Phase, that groups the Tasks in that Home which serve it, such as an HBF app or a line repair programme. A Task is in at most one Project, and putting it in one moves it to the Project's Home.
_Avoid_: Group, workstream, initiative, programme, epic

**Phase**:
Where a Project stands: Idea, Building, Live or Paused.
_Avoid_: Stage, status (Status is for Tasks), state

**Progress**:
A Project's Done Tasks out of all its Tasks, leaving out removed ones. Worked out, never typed in.
_Avoid_: Completion, percentage, score

**Update**:
A dated line of news on a Project, such as what was finished or decided. Like the Trail, an Update is never changed or deleted.
_Avoid_: Log, comment, note (a note belongs to a Task), history

## Work

**Task**:
A single piece of work with one Home, a short title starting with a verb, and a clear finish.
_Avoid_: Action, to-do, item, card (a card is how a Task is drawn, not what it is)

**Status**:
Where a Task stands: Next, Now, Blocked or Done. Each Company has at most ten Tasks in Now, however they are shared between people.
_Avoid_: Stage, state, column, lane, "in progress", "to do"

**Shared**:
A Task a Member has opened to its Company team. No Task is Shared until a Member says so, and Tasks in Talent & organisation or Finance are never Shared.
_Avoid_: Public, visible, external, published

**Priority**:
How much a Task matters: High, Medium or Low, decided by the one-week slip test.
- **High**: if it slips a week, a Target or Lever misses, or the business is exposed (cash, lenders, a key customer, safety, compliance).
- **Medium**: needed this quarter, but a week's slip changes nothing that matters.
- **Low**: everything else.
_Avoid_: Score, impact, urgency, effort, rank, importance

## Evidence

**Document**:
The evidence behind exactly one Task: a File in SharePoint, a Link to a web page, or Claude work. A Document is Draft, In review or Final.
_Avoid_: Attachment, file (unless it is a File), source, asset, deliverable

**Version**:
One saved state of a Document. Replacing a Document creates a new Version of the same Document, not a new Document.
_Avoid_: Revision, copy, iteration

**Trail**:
The append-only record of who changed what, and when, on a Task or Document. Nothing in a Trail is ever erased. Removing a Task or Document takes it off the board but keeps its Trail, and it can be restored.
_Avoid_: History, audit log, activity, changelog

**Capture**:
Turning pasted meeting notes into Suggestions.
_Avoid_: Import, extraction, parsing, AI tasks

**Suggestion**:
A proposed Task from Capture. It does not exist on the board until a Member confirms it.
_Avoid_: Draft task, candidate, proposal, AI task

## People

**Person**:
Anyone the HBF Portal lets into the board: a Member, or someone in a Company team. A Person is on the board before they first sign in.
_Avoid_: User, account

**Member**:
A Sunridge employee on the board. Members see every Task of every Company. In the HBF Portal their role is **Sunridge team**.
_Avoid_: User, account, team member, guest

**Company team**:
The people at a portfolio company whom a portal admin has let into that Company's board, such as the HBF team. They see only that Company's Shared Tasks, and change only the Shared Tasks they own or contribute to. In the HBF Portal their role is **HBF team**.
_Avoid_: Manager, guest, client, external user, company staff

**Owner**:
Someone accountable for a Task: a Person, or a name typed for anyone who isn't on the board. A Task can have several Owners, or none yet ("Needs an owner"). Someone in a Company team can own only a Shared Task in their own Company. While none of a Task's Owners has signed in, any Member may change it. A Project has one Owner.
_Avoid_: Assignee, lead, responsible, DRI

**Company owner**:
The person at the portfolio company who answers for a Task, by name, such as an HBF manager. It gives them no access and no rights on the board.
_Avoid_: HBF owner, client owner, contact

**Contributor**:
A Person who helps on a Task without being accountable for it. Contributors can change the Task and its Documents, just as Owners can. Someone in a Company team can contribute only to a Shared Task in their own Company.
_Avoid_: Helper, collaborator, support, assignee

**Viewer**:
A Person who is neither an Owner nor a Contributor on a Task. Partners are Viewers unless they are added to a Task.
_Avoid_: Reader, observer, follower

## The plan (v2)

**Target**:
A measurable result a Company must reach by a date, with a baseline, such as average monthly EBITDA over a quarter.
_Avoid_: Goal (reserved for later), KPI, objective, budget

**Lever**:
A named initiative expected to add a $ amount per month towards one Target. A Task supports at most one Lever, and many Tasks never support one.
_Avoid_: Workstream, initiative, programme, value driver
