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
- `src/sample/demo.ts`: a made-up workspace for development, tests and screenshots.

## Decisions during the build

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
1. The core loop: started.
