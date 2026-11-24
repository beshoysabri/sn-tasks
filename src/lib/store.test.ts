import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoWorkspace } from '../sample/demo'
import { FakeStandardNotes } from '../test/fakeStandardNotes'
import { readNote, writeNote } from './format/note'
import { findByIdentifier } from './model/workspace'
import { patchTask, run } from './ops'
import { Store } from './store'

const savedText = (host: FakeStandardNotes) => {
  const saves = host.saves()
  const items = saves[saves.length - 1]?.data.items as { uuid: string; content: { text: string; preview_plain?: string } }[] | undefined
  return items?.[0]
}

describe('the store against a fake Standard Notes', () => {
  let host: FakeStandardNotes
  let store: Store
  beforeEach(() => {
    vi.useFakeTimers()
    host = new FakeStandardNotes()
    store = new Store(host.bridge)
    host.register()
  })
  afterEach(() => {
    host.dispose()
    vi.useRealTimers()
  })

  it('opens a Tasks note without saving it', () => {
    host.openNote(writeNote(demoWorkspace()))
    expect(store.getSnapshot().kind).toBe('tasks')
    vi.advanceTimersByTime(2000)
    expect(host.saves()).toHaveLength(0)
  })

  it('saves a change into the open note, shortly after', () => {
    host.openNote(writeNote(demoWorkspace()))
    const ws = store.getSnapshot().ws
    store.apply('Priority', (d) => patchTask(d, findByIdentifier(ws, 'WEB-16')!.id, { priority: 1 }))
    expect(host.saves()).toHaveLength(0)
    vi.advanceTimersByTime(400)
    const item = savedText(host)!
    expect(item.uuid).toBe('note-1')
    expect(findByIdentifier(readNote(item.content.text).workspace, 'WEB-16')!.priority).toBe(1)
    expect(item.content.preview_plain).toMatch(/open/)
  })

  it('never saves into a locked note', () => {
    host.openNote(writeNote(demoWorkspace()), { locked: true })
    const ws = store.getSnapshot().ws
    expect(store.apply('Priority', (d) => patchTask(d, ws.tasks[0].id, { priority: 4 }))).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(host.saves()).toHaveLength(0)
  })

  it('saves at once when the editor loses focus (before another note opens), into the note it belongs to', () => {
    host.openNote(writeNote(demoWorkspace()))
    const ws = store.getSnapshot().ws
    store.apply('Priority', (d) => patchTask(d, ws.tasks[0].id, { priority: 4 }))
    window.dispatchEvent(new Event('blur'))
    host.openNote('', { uuid: 'note-2' })
    expect(host.saves().map((s) => (s.data.items as { uuid: string }[])[0].uuid)).toEqual(['note-1'])
    expect(store.getSnapshot().kind).toBe('empty')
  })

  it('converts an old Kanban board on the first change, not on load', () => {
    host.openNote('@title: Chores\n@status: To Do\n@status: Done\n\n* Buy milk\n  * Status: To Do\n')
    expect(store.getSnapshot().kind).toBe('kanban')
    vi.advanceTimersByTime(1000)
    expect(host.saves()).toHaveLength(0)
    const task = store.getSnapshot().ws.tasks[0]
    store.apply('Done', (d) => patchTask(d, task.id, { status: 'done' }))
    vi.advanceTimersByTime(400)
    const text = savedText(host)!.content.text
    expect(text.startsWith('---\ntasks: 1\n')).toBe(true)
    expect(store.getSnapshot().converting).toBe(false)
    expect(store.getSnapshot().toast?.text).toMatch(/Tasks format/)
  })

  it('merges an edit from another device with an unsaved local one', () => {
    const start = writeNote(demoWorkspace())
    host.openNote(start)
    const ws = store.getSnapshot().ws
    store.apply('Local', (d) => patchTask(d, findByIdentifier(ws, 'WEB-12')!.id, { priority: 1 }))
    const remote = run(readNote(start).workspace, 'Remote', (d) => patchTask(d, findByIdentifier(ws, 'WEB-16')!.id, { status: 'in-progress' }), '2026-11-25T08:00Z').ws
    host.openNote(writeNote(remote))
    const merged = store.getSnapshot().ws
    expect(findByIdentifier(merged, 'WEB-12')!.priority).toBe(1)
    expect(findByIdentifier(merged, 'WEB-16')!.status).toBe('in-progress')
    vi.advanceTimersByTime(400)
    const saved = readNote(savedText(host)!.content.text).workspace
    expect(findByIdentifier(saved, 'WEB-12')!.priority).toBe(1)
    expect(findByIdentifier(saved, 'WEB-16')!.status).toBe('in-progress')
  })

  it('undoes and redoes', () => {
    host.openNote(writeNote(demoWorkspace()))
    const { id, priority } = store.getSnapshot().ws.tasks[0]
    store.apply('Priority', (d) => patchTask(d, id, { priority: 4 }))
    store.undo()
    expect(store.getSnapshot().ws.tasks[0].priority).toBe(priority)
    store.redo()
    expect(store.getSnapshot().ws.tasks[0].priority).toBe(4)
  })

  it('starts a task list in an empty note when asked', () => {
    host.openNote('')
    expect(store.getSnapshot().kind).toBe('empty')
    store.start('Errands')
    const ws = readNote(savedText(host)!.content.text).workspace
    expect(ws.projects.map((p) => [p.name, p.key])).toEqual([['Errands', 'ERR']])
  })
})
