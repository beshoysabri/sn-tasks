/**
 * Export, for the desktop and web apps (Standard Notes' phone app can't save a file an editor makes):
 * the tasks as CSV for a spreadsheet, the note's Markdown as it is saved, or the workspace as JSON.
 */
import { cycleName } from './cycles'
import { writeNote } from './format/note'
import { PRIORITY_NAMES } from './model/defaults'
import type { Workspace } from './model/types'
import { identifier, nowStamp, projectOf, spaceIdOf, statusOf } from './model/workspace'

/** Quotes a cell when it must be; free text that a spreadsheet would run as a formula gets a leading '. */
function cell(value: string, text = false): string {
  const v = text && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v
}

/** One row per task, archived ones included; custom fields after the built-in columns. */
export function toCsv(ws: Workspace): string {
  const head = ['ID', 'Title', 'Status', 'Priority', 'Labels', 'Due', 'Project', 'Space', 'Type', 'Bucket', 'Cycle', 'Parent',
    'Created', 'Updated', 'Completed', 'Archived', 'Comments', 'Description', ...ws.fields.map((f) => f.name)]
  const rows = ws.tasks.map((t) => {
    const parent = t.parent ? ws.tasks.find((p) => p.id === t.parent) : undefined
    const spaceId = spaceIdOf(ws, t)
    const cycle = ws.cycles.find((c) => c.id === t.cycle)
    return [
      cell(identifier(ws, t)),
      cell(t.title, true),
      cell(statusOf(ws, t.status).name),
      cell(t.priority ? PRIORITY_NAMES[t.priority] : ''),
      cell(t.labels.join(', '), true),
      cell(t.due ?? ''),
      cell(projectOf(ws, t)?.name ?? '', true),
      cell(ws.spaces.find((s) => s.id === spaceId)?.name ?? '', true),
      cell(ws.types.find((x) => x.id === t.type)?.name ?? '', true),
      cell(ws.buckets.find((b) => b.id === t.bucket)?.name ?? '', true),
      cell(cycle ? cycleName(cycle) : ''),
      cell(parent ? identifier(ws, parent) : ''),
      cell(t.created),
      cell(t.updated),
      cell(t.completed ?? t.cancelled ?? ''),
      cell(t.archived ?? ''),
      cell(String(t.history.filter((h) => h.kind === 'comment').length)),
      cell(t.description, true),
      ...ws.fields.map((f) => cell(t.fields[f.id] ?? '', f.type !== 'number' && f.type !== 'date')),
    ].join(',')
  })
  return [head.map((h) => cell(h)).join(','), ...rows].join('\r\n') + '\r\n'
}

export function toMarkdown(ws: Workspace): string {
  return writeNote(ws)
}

export function toJson(ws: Workspace, exported = nowStamp()): string {
  return JSON.stringify({ format: 'sn-tasks', version: 1, exported, workspace: ws }, null, 2) + '\n'
}

/** "Personal tasks" on 25 Nov → personal-tasks-2026-11-25.csv */
export function fileName(title: string, extension: string, day: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tasks'
  return `${slug}-${day}.${extension}`
}

/** Hands the browser a file to save. */
export function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
