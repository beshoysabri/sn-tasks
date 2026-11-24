# Build notes

The spec in Notion is the source of truth:
[Task manager editor for Standard Notes — build spec v1](https://app.notion.com/p/42295c93e7ac812785b6e95349087caa)
(research: [Nov 2026](https://app.notion.com/p/42295c93e7ac813aa646c044d4b60e6d)). This file records what the
spec doesn't: how the code is laid out, decisions taken during the build, and where each phase stands.
Newest decisions first.

## Layout

- `src/lib/model/`: the workspace types, built-in vocabulary (statuses, priorities, palette, seeds) and helpers
  (IDs and keys, status categories, identifiers like WEB-12).
- `src/lib/format/note.ts`: format 1, the workspace as readable Markdown, and back. Deterministic writer.
- `src/sample/demo.ts`: a made-up workspace for development, tests and screenshots.

## Decisions during the build

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

0. Foundations: in progress (repository, CI, model, format 1).
