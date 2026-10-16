---
status: accepted
---

# Projects group Tasks in one Home, with a goal, an Owner, a Phase and Updates

The team already tracks Projects on the team board artifact (its `groups` collection), such as the planning tool, Jones line repairs and maintenance overhaul. Arif asked on 16 October 2026 for Projects on the board too, and for each HBF app (Labor App, Production App, their twins, the HBF Portal, Site Flow, Maintenance, Costing, Site Diary, Materials Planning) and the data-modelling work to be a Project. Until now the board had no such idea, and the sync dropped a Task's Project.

A Project lives in one Company and Department, and at most one Area, just like a Task. It has a name, a goal, one Owner (someone at Sunridge on the board, or a typed name), a Phase (Idea, Building, Live or Paused) and, for a Project that builds an app, its repository, Portal app and live address. Its Progress is its Done Tasks out of all its Tasks, never typed in. Updates are dated lines of news on a Project, and like the Trail they are never changed or deleted.

## Rules

- A Task belongs to at most one Project, in the same Home. Putting a Task in a Project moves it to the Project's Home. A Task that moves somewhere else leaves its Project. Moving a Project, or retiring its Area, moves its Tasks with it, each on its own Trail.
- Only Members add, change, move, remove and restore Projects, and add Updates.
- The Company team sees a Project only through the Shared Tasks it can already see: its name and the Progress of those Tasks, not its goal, Owner, Phase, app details or Updates.
- Removing a Project leaves its Tasks where they are. They show no Project until it is restored.

## Sync

The sync carries Projects both ways (artifact `groups`, ADR 0007). The side changed more recently wins on a Project's fields. Updates are merged both ways and never lost: a team board log line and a board Update are the same when they were written at the same moment with the same words. A board Project goes to the team board as `vb-<id>`; a team board Project is linked by the source in its first Trail entry, like Tasks. A team board Task counts as in a group only when both are in the same place, which is also how the artifact draws it.

## Considered options

- **Keep Projects on the team board only.** Nothing to build, but the board would lose them on every sync and Claude couldn't answer "where is Site Flow?".
- **Projects as sub-tasks.** The spec rules out sub-tasks. A Project is a group of Tasks with its own goal and news, not a Task.
- **Use Levers (v2).** A Lever is worth a $ amount per month towards a Target. Most Projects here are tools and clean-ups with no such figure.

## Consequences

- "Project" is now a glossary word; it was on the avoid list for Company and Lever.
- New tables `vb_projects` and `vb_project_updates` (append-only: the app login may only INSERT and SELECT), and `vb_tasks.project_id`. Existing databases need `npm run db:init` once.
