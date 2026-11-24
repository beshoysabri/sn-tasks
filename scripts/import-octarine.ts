// One-time import of Octarine tasks into a Standard Notes backup file holding one note that opens in
// Tasks. Import it in Standard Notes under Preferences › Backups › Import backup.
//
//   unzip octarine.zip -d /data/claude/var/octarine-import      (a copy of the workspace's .octarine folder)
//   npx vite-node scripts/import-octarine.ts /data/claude/var/octarine-import/.octarine "Tasks" > tasks.json
//
// Prints what it couldn't read to stderr. Keep the output out of the repository: it holds real tasks.
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { previewLine, writeNote } from '../src/lib/format/note'
import { nowStamp, today } from '../src/lib/model/workspace'
import { importOctarine, type SourceFile } from '../src/lib/importOctarine'

const [dir, title = 'Tasks'] = process.argv.slice(2)
if (!dir) {
  console.error('usage: npx vite-node scripts/import-octarine.ts <path to .octarine> [note title]')
  process.exit(2)
}
const files: SourceFile[] = []
const walk = (path: string) => {
  for (const name of readdirSync(path)) {
    const full = join(path, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(md|json|jsonl|ya?ml)$/.test(name)) files.push({ path: relative(dir, full), text: readFileSync(full, 'utf8') })
  }
}
walk(dir)
const { workspace, warnings } = importOctarine(files, nowStamp())
for (const w of warnings) console.error(`warning: ${w}`)
console.error(`${workspace.projects.length} projects, ${workspace.tasks.length} tasks, ${workspace.spaces.length} spaces`)
const text = writeNote(workspace)
const now = new Date()
const iso = now.toISOString()
const micros = now.getTime() * 1000
const note = {
  uuid: randomUUID(),
  content_type: 'Note',
  created_at: iso,
  updated_at: iso,
  created_at_timestamp: micros,
  updated_at_timestamp: micros,
  content: {
    title,
    text,
    references: [],
    noteType: 'markdown',
    editorIdentifier: 'com.beshoysabri.sn-tasks',
    preview_plain: previewLine(workspace, today()),
    spellcheck: false,
    appData: { 'org.standardnotes.sn': { client_updated_at: iso } },
  },
}
process.stdout.write(`${JSON.stringify({ version: '004', items: [note] }, null, 2)}\n`)
