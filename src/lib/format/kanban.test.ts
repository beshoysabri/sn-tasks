import { describe, expect, it } from 'vitest'
import { identifier } from '../model/workspace'
import { isKanbanNote, readKanban } from './kanban'
import { readNote, writeNote } from './note'

const NOW = '2026-11-24T12:00Z'

const NEW_FORMAT = `@title: Website relaunch
@description: Q4 plan
@view: board
@status: Backlog
@status: To Do
@status: Doing [color:Ocean]
@status: Waiting [color:Mustard]
@status: Done [color:Sage]
@group: Design [color:Lavender]
@group: Content [color:Peach]
@subgroup: Sprint 1
@field: effort [type:select] [name:Effort] [options:S,M,L] [colors:L=#CB7876]
@field: links [type:media] [name:Links]

* Write release notes
  * Description: For the blog and the changelog
  * Status: To Do
  * Group: Content
  * SubGroup: Sprint 1
  * Priority: high
  * DueDate: 2026-11-28
  * Label: Docs
  * LabelColor: #8C7DA8
  * Effort: L
  * Links: https://a.example|https://b.example
  * Checklist:
    * [x] Draft
    * [ ] Review
  * Comments:
    * Ask Sam for the numbers
* Fix signup link
  * Status: Doing
  * Priority: critical
* Old idea
  * Status: Done
`

const OLD_FORMAT = `# To Do
* Buy milk
  * Priority: low
# Done [color:Sage]
* Pay rent
`

describe('Kanban Board notes', () => {
  it('recognises both formats and nothing else', () => {
    expect(isKanbanNote(NEW_FORMAT)).toBe(true)
    expect(isKanbanNote(OLD_FORMAT)).toBe(true)
    expect(isKanbanNote('# A heading\n\nSome prose.')).toBe(false)
    expect(isKanbanNote('Just text')).toBe(false)
  })

  it('turns a board into one project with everything kept', () => {
    const { workspace: ws, view, warnings } = readKanban(NEW_FORMAT, NOW)
    expect(view).toBe('board')
    expect(warnings).toEqual([])
    expect(ws.projects).toHaveLength(1)
    const project = ws.projects[0]
    expect(project).toMatchObject({ name: 'Website relaunch', key: 'WER', description: 'Q4 plan', next: 4 })
    const [notes, signup, idea] = ws.tasks
    expect(identifier(ws, notes)).toBe('WER-1')
    expect(notes.status).toBe('todo')
    expect(notes.priority).toBe(2)
    expect(notes.due).toBe('2026-11-28')
    expect(notes.labels).toEqual(['Content', 'Sprint-1', 'Docs'])
    expect(notes.description).toBe('For the blog and the changelog\n\n- [x] Draft\n- [ ] Review')
    expect(notes.fields).toEqual({ effort: 'L', links: 'https://a.example\nhttps://b.example' })
    expect(notes.history.map((h) => h.kind)).toEqual(['created', 'comment'])
    expect(notes.history[1].text).toBe('Ask Sam for the numbers')
    expect(signup.status).toBe('in-progress')
    expect(signup.priority).toBe(1)
    expect(idea.status).toBe('done')
    expect(idea.completed).toBe(NOW)
    // Waiting has no built-in: it stays as a custom status with its colour.
    expect(ws.statuses.find((s) => s.name === 'Waiting')).toMatchObject({ category: 'started', color: '#F4D35E', builtin: false })
    expect(ws.labels.find((l) => l.name === 'Design')?.color).toBe('#BBA6DD')
    expect(ws.fields.find((f) => f.id === 'effort')?.options).toEqual([{ value: 'S' }, { value: 'M' }, { value: 'L', color: '#CB7876' }])
  })

  it('reads the oldest format, statuses from headings', () => {
    const { workspace: ws } = readKanban(OLD_FORMAT, NOW)
    expect(ws.tasks.map((t) => [t.title, t.status, t.priority])).toEqual([
      ['Buy milk', 'todo', 4],
      ['Pay rent', 'done', 0],
    ])
    expect(ws.projects[0].name).toBe('Board')
  })

  it('survives a round trip through format 1', () => {
    const { workspace } = readKanban(NEW_FORMAT, NOW)
    const text = writeNote(workspace)
    const back = readNote(text).workspace
    expect(back.tasks.map((t) => t.title)).toEqual(workspace.tasks.map((t) => t.title))
    expect(back.tasks[0].fields).toEqual(workspace.tasks[0].fields)
    expect(writeNote(back)).toBe(text)
  })
})
