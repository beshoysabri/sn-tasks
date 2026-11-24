import { describe, expect, it } from 'vitest'
import { demoWorkspace } from '../sample/demo'
import { findByIdentifier, identifier } from './model/workspace'
import { addComment, archiveTasks, createTask, deleteTasks, moveToProject, run, setParent, setStatus, toggleDone, undo } from './ops'

const NOW = '2026-11-24T15:00Z'
const byId = (ws: ReturnType<typeof demoWorkspace>, id: string) => findByIdentifier(ws, id)!

describe('operations', () => {
  it('numbers a new task in its project and records its creation', () => {
    const ws = demoWorkspace()
    const { ws: next, change } = run(ws, 'New task', (d) => {
      createTask(d, { title: 'Write the FAQ', project: 'website', labels: ['Docs'] }, 'newtask1')
    }, NOW)
    const task = next.tasks.find((t) => t.id === 'newtask1')!
    expect(identifier(next, task)).toBe('WEB-19')
    expect(task.status).toBe('todo')
    expect(task.history).toEqual([{ at: NOW, kind: 'created' }])
    expect(next.projects.find((p) => p.id === 'website')!.next).toBe(20)
    expect(change!.tasks.get('newtask1')).toBeNull()
  })

  it('records status changes, stamps completion, and undoes only what it touched', () => {
    const ws = demoWorkspace()
    const { ws: done, change } = run(ws, 'Done', (d) => setStatus(d, [byId(ws, 'WEB-12').id], 'done'), NOW)
    const task = byId(done, 'WEB-12')
    expect(task.status).toBe('done')
    expect(task.completed).toBe(NOW)
    expect(task.history.at(-1)).toEqual({ at: NOW, kind: 'status', from: 'In review', to: 'Done' })
    // Another device changes a different task meanwhile; undo must not touch it.
    const other = { ...byId(done, 'WEB-16'), title: 'Changed elsewhere' }
    const merged = { ...done, tasks: done.tasks.map((t) => (t.id === other.id ? other : t)) }
    const back = undo(merged, change!).ws
    expect(byId(back, 'WEB-12')).toEqual(byId(ws, 'WEB-12'))
    expect(byId(back, 'WEB-16').title).toBe('Changed elsewhere')
  })

  it('closes open subtasks with their parent when asked', () => {
    const ws = demoWorkspace()
    const { ws: next } = run(ws, 'Done', (d) => toggleDone(d, [byId(ws, 'WEB-14').id], true), NOW)
    expect(byId(next, 'WEB-14').status).toBe('done')
    expect(byId(next, 'WEB-17').status).toBe('done')
  })

  it('moves a task to another project with a new number, the old ID still finds it', () => {
    const ws = demoWorkspace()
    const { ws: next } = run(ws, 'Move', (d) => moveToProject(d, [byId(ws, 'WEB-14').id], 'homeproj'), NOW)
    const moved = next.tasks.find((t) => t.id === byId(ws, 'WEB-14').id)!
    expect(identifier(next, moved)).toBe('HOME-7')
    expect(moved.aliases).toEqual(['WEB-14'])
    expect(findByIdentifier(next, 'WEB-14')?.id).toBe(moved.id)
    // Its subtasks follow.
    const kid = next.tasks.find((t) => t.id === byId(ws, 'WEB-17').id)!
    expect(identifier(next, kid)).toBe('HOME-9')
    expect(moved.history.at(-1)).toMatchObject({ kind: 'project', from: 'Website', to: 'Home' })
  })

  it('keeps subtasks one level deep', () => {
    const ws = demoWorkspace()
    const parent = byId(ws, 'WEB-14')
    const { ws: next } = run(ws, 'Parent', (d) => setParent(d, [parent.id], byId(ws, 'WEB-12').id), NOW)
    expect(byId(next, 'WEB-14').parent).toBeUndefined()
  })

  it('archives, comments and deletes with subtasks', () => {
    const ws = demoWorkspace()
    const id = byId(ws, 'WEB-14').id
    let next = run(ws, 'Archive', (d) => archiveTasks(d, [id], true), NOW).ws
    expect(byId(next, 'WEB-14').archived).toBe(NOW)
    next = run(next, 'Comment', (d) => addComment(d, id, '  Looks fixed.  '), NOW).ws
    expect(byId(next, 'WEB-14').history.at(-1)).toEqual({ at: NOW, kind: 'comment', text: 'Looks fixed.' })
    next = run(next, 'Delete', (d) => deleteTasks(d, [id]), NOW).ws
    expect(next.tasks.some((t) => t.id === id || t.parent === id)).toBe(false)
  })

  it('returns the same workspace when nothing changed', () => {
    const ws = demoWorkspace()
    const result = run(ws, 'Nothing', () => {}, NOW)
    expect(result.ws).toBe(ws)
    expect(result.change).toBeNull()
  })
})
