import { describe, expect, it } from 'vitest'
import { demoWorkspace } from '../../sample/demo'
import { emptyWorkspace } from '../model/defaults'
import { escapeBody, readNote, unescapeBody, writeNote } from './note'

describe('format 1', () => {
  it('writes and reads back the same workspace', () => {
    const ws = demoWorkspace()
    const text = writeNote(ws)
    const { kind, workspace, warnings } = readNote(text)
    expect(kind).toBe('tasks')
    expect(warnings).toEqual([])
    expect(workspace.tasks).toHaveLength(ws.tasks.length)
    for (const task of ws.tasks) {
      const back = workspace.tasks.find((t) => t.id === task.id)!
      expect(back, task.title).toBeDefined()
      expect(back).toEqual({ ...task, order: task.order, aliases: task.aliases })
    }
    expect(workspace.projects).toEqual(ws.projects)
    expect(workspace.spaces).toEqual(ws.spaces)
    expect(workspace.statuses).toEqual(ws.statuses)
    expect(workspace.labels).toEqual(ws.labels)
    expect(workspace.types).toEqual(ws.types)
    expect(workspace.buckets).toEqual(ws.buckets)
    expect(workspace.fields).toEqual(ws.fields)
    expect(workspace.filters).toEqual(ws.filters)
    expect(workspace.settings).toEqual(ws.settings)
  })

  it('is deterministic: writing what it read gives the same text', () => {
    const text = writeNote(demoWorkspace())
    expect(writeNote(readNote(text).workspace)).toBe(text)
  })

  it('reads as plain Markdown', () => {
    const text = writeNote(demoWorkspace())
    expect(text).toMatch(/^---\ntasks: 1\n/)
    expect(text).toContain('\n# Career\n')
    expect(text).toContain('\n## Website\n- Key: WEB\n')
    expect(text).toContain('\n### WEB-14 Fix broken signup link on the pricing page\n- Status: In progress\n- Priority: Urgent\n- Labels: Bug\n')
    expect(text).toContain('\n#### WEB-17 Redirect /signup to /start\n')
    expect(text).toContain('Comment: Support says it also breaks')
    expect(text).toContain('\n# No project\n')
  })

  it('keeps descriptions that look like structure, exactly', () => {
    const ws = emptyWorkspace()
    const description = '# Not a heading\n> not history\n  ## indented\n\\# already escaped\n- Status: not a property\n```\n# in a fence\n```'
    ws.tasks.push({
      id: 'abc123', number: 1, title: 'Tricky', description, status: 'todo', priority: 0, labels: [], created: '2026-11-24T10:00Z',
      updated: '2026-11-24T10:00Z', aliases: [], fields: {}, history: [{ at: '2026-11-24T10:00Z', kind: 'comment', text: 'line one\nline two' }],
    })
    ws.settings.noProjectNext = 2
    const back = readNote(writeNote(ws)).workspace.tasks[0]
    expect(back.description).toBe(description)
    expect(back.history).toEqual([{ at: '2026-11-24T10:00Z', kind: 'comment', text: 'line one\nline two', edited: undefined }])
  })

  it('closes a code fence a description leaves open, so the tasks after it survive', () => {
    const ws = emptyWorkspace()
    const task = (id: string, number: number, title: string, description: string) => ({
      id, number, title, description, status: 'todo', priority: 0 as const, labels: [], created: '2026-11-24T10:00Z',
      updated: '2026-11-24T10:00Z', aliases: [], fields: {}, history: [],
    })
    ws.tasks.push(task('snip01', 1, 'Snippet', 'Run this:\n````sh\n# not a heading\nnpm test'), task('after2', 2, 'After it', ''))
    ws.settings.noProjectNext = 3
    const text = writeNote(ws)
    const back = readNote(text).workspace
    expect(back.tasks.map((t) => t.title)).toEqual(['Snippet', 'After it'])
    expect(back.tasks[0].description).toBe('Run this:\n````sh\n# not a heading\nnpm test\n````')
    expect(writeNote(back)).toBe(text)
  })

  it('keeps the text of a plain note that becomes a task list, headings and all', () => {
    const ws = demoWorkspace()
    ws.preamble = '# Meeting notes\n> a quote\n```\nopen fence'
    const back = readNote(writeNote(ws)).workspace
    expect(back.preamble).toBe('# Meeting notes\n> a quote\n```\nopen fence\n```')
    expect(back.spaces.map((s) => s.name)).toEqual(ws.spaces.map((s) => s.name))
    expect(back.tasks.length).toBe(ws.tasks.length)
  })

  it('keeps the first day of the week and a cycle schedule while cycles are off', () => {
    const ws = demoWorkspace()
    ws.settings.weekStart = 6
    ws.cycleSettings = { enabled: false, weeks: 3, startDay: 6 }
    ws.cycles = []
    const text = writeNote(ws)
    expect(text).toContain('\nweek-starts: Sunday\n')
    const back = readNote(text).workspace
    expect(back.settings.weekStart).toBe(6)
    expect(back.cycleSettings).toEqual({ enabled: false, weeks: 3, startDay: 6 })
    expect(writeNote(emptyWorkspace())).not.toMatch(/week-starts|cycles:/)
  })

  it('escapes and unescapes losslessly', () => {
    const samples = ['# h', '> q', '\\# e', '\\\\> ee', '  # i', 'plain', '#hashtag']
    for (const s of samples) expect(unescapeBody(escapeBody(s))).toBe(s)
  })

  it('gives hand-written tasks the next number and keeps unknown lines in the description', () => {
    const text = [
      '---',
      'tasks: 1',
      'no-project: {"key":"TASK","next":1}',
      '---',
      '',
      'Notes before the first heading stay.',
      '',
      '## Errands',
      '- Key: ERR',
      '- Next: 3',
      '',
      '### ERR-2 Buy stamps',
      '- Status: Done',
      '',
      '### Pick up the parcel',
      '- Colour: blue',
      'Some description.',
    ].join('\n')
    const { workspace } = readNote(text)
    expect(workspace.preamble).toBe('Notes before the first heading stay.')
    const [stamps, parcel] = workspace.tasks
    expect(stamps.number).toBe(2)
    expect(stamps.status).toBe('done')
    expect(parcel.number).toBe(3)
    expect(parcel.description).toBe('- Colour: blue\nSome description.')
    expect(workspace.projects[0].next).toBe(4)
  })

  it('reports an unknown status instead of failing', () => {
    const text = '---\ntasks: 1\n---\n\n# No project\n\n### TASK-1 A\n- Status: Someday\n'
    const { workspace, warnings } = readNote(text)
    expect(workspace.tasks[0].status).toBe('todo')
    expect(warnings[0]).toMatch(/Someday/)
  })

  it('tells other notes apart', () => {
    expect(readNote('').kind).toBe('empty')
    expect(readNote('Just a note').kind).toBe('other')
    expect(readNote('@title: Board\n@status: To Do\n').kind).toBe('other')
  })

  it('keeps custom field values with newlines and quotes', () => {
    const ws = demoWorkspace()
    ws.fields.push({ id: 'notes', name: 'Notes', type: 'textarea', options: [] })
    ws.tasks[0].fields.notes = 'first\n"second"'
    const back = readNote(writeNote(ws)).workspace.tasks.find((t) => t.id === ws.tasks[0].id)!
    expect(back.fields.notes).toBe('first\n"second"')
  })
})
