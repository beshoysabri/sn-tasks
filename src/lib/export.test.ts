import { describe, expect, it } from 'vitest'
import { demoWorkspace } from '../sample/demo'
import { fileName, toCsv, toJson, toMarkdown } from './export'
import { readNote } from './format/note'
import { identifier } from './model/workspace'

/** A small CSV reader (quotes, doubled quotes, newlines in cells) to check what a spreadsheet would see. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else cell += c
  }
  return rows
}

describe('export', () => {
  it('writes one CSV row per task that a spreadsheet reads back exactly', () => {
    const ws = demoWorkspace()
    ws.fields.push({ id: 'effort', name: 'Effort', type: 'select', options: [] })
    ws.tasks[0].fields.effort = 'L'
    ws.tasks[0].title = '=SUM(A1), then say "hi"'
    const rows = parseCsv(toCsv(ws))
    expect(rows[0].slice(0, 6)).toEqual(['ID', 'Title', 'Status', 'Priority', 'Labels', 'Due'])
    expect(rows[0].at(-1)).toBe('Effort')
    expect(rows).toHaveLength(ws.tasks.length + 1)
    const first = rows[1]
    expect(first[0]).toBe(identifier(ws, ws.tasks[0]))
    expect(first[1]).toBe(`'=SUM(A1), then say "hi"`)
    expect(rows[2][1]).toBe(ws.tasks[1].title)
    expect(first.at(-1)).toBe('L')
    const withDescription = ws.tasks.findIndex((t) => t.description.includes('\n'))
    expect(rows[withDescription + 1][17]).toBe(ws.tasks[withDescription].description)
    for (const r of rows) expect(r).toHaveLength(rows[0].length)
  })

  it('exports the note as it is saved, and everything as JSON', () => {
    const ws = demoWorkspace()
    expect(readNote(toMarkdown(ws)).workspace.tasks).toHaveLength(ws.tasks.length)
    const json = JSON.parse(toJson(ws, '2026-11-25T10:00Z'))
    expect(json).toMatchObject({ format: 'sn-tasks', version: 1, exported: '2026-11-25T10:00Z' })
    expect(json.workspace).toEqual(JSON.parse(JSON.stringify(ws)))
  })

  it('names files after the note', () => {
    expect(fileName('Personal tasks', 'csv', '2026-11-25')).toBe('personal-tasks-2026-11-25.csv')
    expect(fileName('Résumé · 2026', 'md', '2026-11-25')).toBe('resume-2026-2026-11-25.md')
    expect(fileName('مهام البيت', 'json', '2026-11-25')).toBe('مهام-البيت-2026-11-25.json')
    expect(fileName('  ', 'csv', '2026-11-25')).toBe('tasks-2026-11-25.csv')
  })
})
