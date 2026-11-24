import { describe, expect, it } from 'vitest'
import { demoWorkspace } from '../sample/demo'
import { findByIdentifier, identifier } from './model/workspace'
import { merge } from './merge'
import { addComment, createTask, deleteTasks, patchTask, run } from './ops'

const T1 = '2026-11-24T15:00Z'
const T2 = '2026-11-24T15:05Z'
const id = (ws: ReturnType<typeof demoWorkspace>, ticket: string) => findByIdentifier(ws, ticket)!.id

describe('merging a note changed on two devices', () => {
  const base = demoWorkspace()

  it('keeps changes to different tasks from both sides', () => {
    const local = run(base, 'a', (d) => patchTask(d, id(base, 'WEB-12'), { priority: 1 }), T1).ws
    const remote = run(base, 'b', (d) => patchTask(d, id(base, 'WEB-16'), { status: 'in-progress' }), T2).ws
    const { ws, conflicts } = merge(base, local, remote)
    expect(findByIdentifier(ws, 'WEB-12')!.priority).toBe(1)
    expect(findByIdentifier(ws, 'WEB-16')!.status).toBe('in-progress')
    expect(conflicts).toEqual([])
  })

  it('merges different fields of the same task, and keeps both sides’ history', () => {
    const t = id(base, 'WEB-12')
    const local = run(base, 'a', (d) => patchTask(d, t, { priority: 1 }), T1).ws
    const remote = run(base, 'b', (d) => patchTask(d, t, { due: '2026-12-01' }), T2).ws
    const merged = findByIdentifier(merge(base, local, remote).ws, 'WEB-12')!
    expect(merged.priority).toBe(1)
    expect(merged.due).toBe('2026-12-01')
    expect(merged.history.slice(-2).map((h) => h.kind)).toEqual(['priority', 'due'])
  })

  it('keeps the later edit when both changed the same property', () => {
    const t = id(base, 'WEB-12')
    const local = run(base, 'a', (d) => patchTask(d, t, { status: 'done' }), T1).ws
    const remote = run(base, 'b', (d) => patchTask(d, t, { status: 'cancelled' }), T2).ws
    expect(findByIdentifier(merge(base, local, remote).ws, 'WEB-12')!.status).toBe('cancelled')
  })

  it('reports a title edited on both sides and keeps the local one', () => {
    const t = id(base, 'WEB-12')
    const local = run(base, 'a', (d) => patchTask(d, t, { title: 'Mine' }), T1).ws
    const remote = run(base, 'b', (d) => patchTask(d, t, { title: 'Theirs' }), T2).ws
    const { ws, conflicts } = merge(base, local, remote)
    expect(findByIdentifier(ws, 'WEB-12')!.title).toBe('Mine')
    expect(conflicts).toEqual([{ id: t, remote: { title: 'Theirs', description: findByIdentifier(remote, 'WEB-12')!.description } }])
  })

  it('keeps comments written on both devices', () => {
    const t = id(base, 'WEB-14')
    const local = run(base, 'a', (d) => addComment(d, t, 'From my laptop'), T1).ws
    const remote = run(base, 'b', (d) => addComment(d, t, 'From my phone'), T2).ws
    const texts = findByIdentifier(merge(base, local, remote).ws, 'WEB-14')!.history.filter((h) => h.kind === 'comment').map((h) => h.text)
    expect(texts).toEqual(['Support says it also breaks in the app’s webview, so test there too.', 'From my laptop', 'From my phone'])
  })

  it('gives two new tasks with the same number different IDs', () => {
    const local = run(base, 'a', (d) => createTask(d, { title: 'On the laptop', project: 'website' }, 'laptop1'), T1).ws
    const remote = run(base, 'b', (d) => createTask(d, { title: 'On the phone', project: 'website' }, 'phone01'), T2).ws
    const { ws } = merge(base, local, remote)
    const phone = ws.tasks.find((t) => t.id === 'phone01')!
    const laptop = ws.tasks.find((t) => t.id === 'laptop1')!
    expect(identifier(ws, phone)).toBe('WEB-19')
    expect(identifier(ws, laptop)).toBe('WEB-20')
    expect(ws.projects.find((p) => p.id === 'website')!.next).toBe(21)
  })

  it('never loses a change to something the other side deleted', () => {
    const t = id(base, 'WEB-16')
    const local = run(base, 'a', (d) => deleteTasks(d, [t]), T1).ws
    const changed = run(base, 'b', (d) => patchTask(d, t, { priority: 2 }), T2).ws
    expect(merge(base, local, changed).ws.tasks.some((x) => x.id === t)).toBe(true)
    expect(merge(base, local, base).ws.tasks.some((x) => x.id === t)).toBe(false)
  })
})
