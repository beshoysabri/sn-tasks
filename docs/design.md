# Build notes

The spec in Notion is the source of truth:
[Task manager editor for Standard Notes — build spec v1](https://app.notion.com/p/42295c93e7ac812785b6e95349087caa)
(research: [Nov 2026](https://app.notion.com/p/42295c93e7ac813aa646c044d4b60e6d)). This file records what the
spec doesn't: how the code is laid out, decisions taken during the build, and where each phase stands.
Newest decisions first.

## Layout

- `src/lib/sn/bridge.ts`: Standard Notes' component protocol (Money Month's bridge plus the note title).
- `src/lib/store.ts`: the app state: loading a note (Tasks, old Kanban, empty, other), saving, merging,
  undo/redo, toasts, per-note view state in component data.
- `src/lib/ops.ts`: every change as an operation on a draft that remembers what it touched (undo, history).
- `src/lib/merge.ts`: three-way merge of the note changed on two devices.
- `src/lib/query.ts`: the filter language, sorting, Up next, due buckets.
- `src/lib/quickadd.ts`: #label, !priority and date parsing for the new-task title, with completions.
- `src/lib/format/kanban.ts`: old Kanban Board notes into a workspace.
- `src/lib/model/`: the workspace types, built-in vocabulary (statuses, priorities, palette, seeds) and helpers
  (IDs and keys, status categories, identifiers like WEB-12).
- `src/lib/format/note.ts`: format 1, the workspace as readable Markdown, and back. Deterministic writer.
- `src/lib/settingsOps.ts`: statuses, labels, types, buckets and custom fields; renaming or deleting one
  updates every task, project and type that uses it.
- `src/lib/cycles.ts`: cycles (make the active and upcoming ones, complete one, numbers).
- `src/lib/view.ts`: rows and groups for the list and the board (folding, subtasks, context rows).
- `src/lib/importOctarine.ts` + `scripts/import-octarine.ts`: the one-time Octarine import.
- `src/components/`: `Shell.tsx` (sidebar, toolbar, keys, overview, project settings), `TaskList`, `Board`,
  `TableView`, `TaskDetail` (preview and page), `CreateDialog` (quick add), `Picker`, `WorkspaceSettings`,
  `SpaceOverview`, `CycleViews`, `ProjectActivity`. Heavy ones load on demand (see below).
- `src/sample/demo.ts`: a made-up workspace for development, tests and screenshots.
- `src/App.test.tsx`: the editor end to end against the fake Standard Notes host (start a list, quick add,
  keyboard triage, Kanban conversion); the rest of the tests sit beside the code they test.

## Decisions during the build

- 2026-11-25 · **The first day of the week is a setting** (Saturday, Sunday or Monday; `week-starts: Sunday`
  in the note, written only when it isn't Monday). "This week" (due groups, `due:this-week`, the Due this week
  filter, the note's preview line) runs to the day before the next week starts; `due:this-week` includes
  overdue tasks, the due group doesn't (they have their own). "Next week" in the pickers and `next week` in
  quick add mean the day the next week starts. A year of activity is drawn in those weeks. Cycles keep their
  own start day. Cycle settings are now kept in the note while cycles are off. The preview line counted the
  week's end in UTC, a day early east of UTC; it uses local dates now.
- 2026-11-25 · **The Octarine importer was checked against a real 0.58 workspace** and adjusted to it:
  `tasks/config.yml` holds `unassigned_key` and its `unassigned_key_aliases`, `project_numbers` and
  `unassigned_number_highwater` (the highest numbers handed out, so new IDs never reuse one) and `cycles`
  (`duration_days`, `enabled`, `start_day` with 0 = Monday); projects carry `key_aliases` (old keys, kept as
  task aliases); colours are names (including `azure`, `magenta` and `theme-icon`, which means none); icons
  are `lucide:Name` or Heroicons names (`AcademicCapIcon`); Lucide dropped brand icons such as Codepen, drawn
  as a hexagon; seeded views, types and buckets (`viewdefaultweek000000000`…) keep Tasks' seeded ids, and an
  untouched "Due this week" becomes Tasks' own; archived labels, types, buckets and statuses come only if a
  task uses them; labels and views keep Octarine's order (order field, then creation time).

- 2026-11-25 · **Archived projects and spaces stay reachable**: the sidebar's "N archived" opens a list of
  them (and of the projects inside an archived space), so Restore, which lives in their own menus, can be
  found. Spaces gained Archive / Restore next to Delete.
- 2026-11-25 · **Activity by status or by label, up to a year**: a year is drawn a week per bar; by label, a
  task counts under its first label, and beyond the five busiest labels the rest share one colour.

- 2026-11-25 · **Export from Settings › General**: CSV (one row per task, archived ones too; custom fields as
  columns; free text that a spreadsheet would run as a formula gets a leading '), Markdown (the note as saved)
  and JSON (the whole workspace). Checked in the Standard Notes web app: the editor's iframe sandbox has
  `allow-downloads`, and the CSV download starts. The phone app can't save a file, so there the section says so.
- 2026-11-25 · **If drawing fails, the note's text shows read-only** (an error boundary around the shell);
  opening another note tries again.
- 2026-11-25 · **Long-press opens the task menu in the list and the table** (iOS never fires contextmenu);
  moving the finger cancels it, and the tap that ends it doesn't also open the task. On the board a
  long-press starts a drag instead, as before.

- 2026-11-25 · **A code fence left open is closed when the note is written.** The reader ignores headings
  inside fences, so an open fence in a description swallowed every task after it on the next load. Markdown
  runs an open fence to the end anyway, so closing it at the end of the text shows the same. The text kept
  from a plain note that became a task list is escaped like a description, so its headings stay text.
- 2026-11-25 · **The Octarine import is a script, not part of the editor**: it runs once, reads a folder of
  files the editor can't reach, and would only add weight to every load. It writes a Standard Notes backup
  holding one Tasks note (Preferences › Backups › Import backup). It reads Octarine's task files as far as
  the bundled UI shows their shape; the real workspace may differ, so it reports what it skips.
- 2026-11-25 · **Cycles never close themselves** (as in Octarine): past its end the active cycle reads
  "Ready to close", and Complete cycle asks where each unfinished task goes (the next cycle by default,
  or none), keeps the cycle's numbers (planned, done, added, carried over), promotes the upcoming cycle
  and makes the next.
- 2026-11-25 · **Workspace vocabulary is renamed everywhere at once**: renaming or deleting a status, label,
  type, bucket or field updates each task, project, space and type that uses it, as one undoable change.
  Built-in statuses can be recoloured, not renamed or deleted.

- 2026-11-25 · **Checked inside the real Standard Notes web app** (app.standardnotes.com, offline, no account,
  headless Chromium; `scripts/sn-check.mjs`): installed through Manage Plugins, Standard Notes asked to
  "Activate Plugin" (Continue), the note opened in Tasks, "Start a task list" made a project, quick add
  "Fix the signup link #bug !urgent tomorrow" made PET-1 with Bug, Urgent and tomorrow, the toast offered
  Open, the notes list showed the preview "1 open · 1 due this week", and the note read back as format 1.
- 2026-11-24 · **Heavy parts load on demand** (board with dnd-kit, table, task view with marked, picker and
  new-task dialog with chrono) and are fetched 0.8 s after the list appears, so the first C isn't lost.
  First load 131 KB gzipped (budget 150 KB, checked in CI).

- 2026-11-24 · **A pending save goes out the moment the editor loses focus** (window blur, pagehide, hidden).
  When Standard Notes switches notes the bridge already holds the next note, and a save for the previous one
  would be refused; clicking the notes list blurs the iframe first, so the save lands in time.
- 2026-11-24 · **The store records what it saves before handing it to the bridge**: the bridge echoes the save
  back synchronously, and that echo must not be merged as a change from another device.
- 2026-11-24 · **Undo puts back only what an operation touched** (previous versions of those tasks and settings),
  so edits merged in from another device in between survive an undo.
- 2026-11-24 · **Merge**: field by field; both sides changed → the later `updated` wins, except title and
  description (local kept, reported as a conflict for the banner); history unioned; deletions never win over
  changes; same-number tasks from two devices renumbered (the one only this device has moves up).

- 2026-11-24 · **Format 1 settled.** Settings live in a YAML front matter whose list items are JSON objects
  (valid YAML, read with JSON.parse). `#` = space (`# Projects` and `# No project` are reserved), `##` = project,
  `###` = task, `####` = subtask. Properties are one `- Key: value` per line up to a blank line; values with a
  newline or a leading quote are JSON strings. Description lines starting with `#` or `>` get a backslash
  (lossless). History and comments are `> 2026-11-24T12:02Z · …` lines at the end of a task, oldest first;
  times are UTC to the minute. Statuses, types and buckets are written by name, read back by name.
- 2026-11-24 · **New repository** (his choice): sn-tasks, identifier `com.beshoysabri.sn-tasks`; the Kanban
  Board stays untouched. `main` holds only what is deployed; work happens on branches, CI checks every branch,
  `main` deploys to GitHub Pages on his word.

## Phases

0. Foundations: done 2026-11-24 except the checks inside the Standard Notes web app (repository, CI, model,
   format 1, Kanban reader, filter language, quick add, operations with undo, merge, bridge and store; 54 tests).
1. The core loop: built 2026-11-24/25 (sidebar, list, board, table, preview and page, quick add, picker,
   right-click menu, selection bar, keys, undo, overview and project settings basics, phone layout).
   Checked inside the Standard Notes web app 2026-11-25.
2. Board, filters, settings, fields and table: built 2026-11-25 (display options per place, saved filters,
   workspace settings for statuses, labels, types, buckets, custom fields and cycles; fields in the table).
3. Overview, spaces, cycles and the Octarine import: built 2026-11-25 (space overview, project activity
   chart and links, cycles with Complete cycle, the import script). The import still needs a check against
   a real `.octarine` folder.

Released as 1.0.0 on 2026-11-25 on his word ("deploy once you're done"): `v0.1` merged into `main`, which
deploys to GitHub Pages (legacy source, the `gh-pages` branch). Before that: the visual review at 390, 768,
1100 and 1280 px in dark and light (the phone task header was fixed), the in-app check, and his Octarine
workspace imported into the Standard Notes web app end to end. Later releases: work on a branch, then
merge on his word.
