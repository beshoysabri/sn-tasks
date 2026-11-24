import { describe, expect, it } from 'vitest'
import { readNote, writeNote } from './format/note'
import { identifier } from './model/workspace'
import { importOctarine } from './importOctarine'

// Shaped like what octarine-portable's CI saw in a real 0.58 workspace (made-up content).
const files = [
  { path: 'config.yml', text: 'unassigned_key: TASK\n' },
  { path: 'tasks/projects/cm0proj000000000000000001.md', text: '---\ncolor: purple\nicon: lucide:Globe\nkey: WEB\nname: Website\nstate: active\nstatus: in-progress\ntargetDate: 2026-12-15\n---\nRelaunch the site.\n' },
  { path: 'tasks/statuses/blocked.md', text: '---\ncategory: started\ncolor: amber\nname: Blocked\n---\n' },
  { path: 'tasks/labels/cm0label00000000000000001.md', text: '---\ncolor: red\nname: Bug\n---\n' },
  { path: 'tasks/cm0task000000000000000001.md', text: "---\ncreated: 2026-11-19T16:42:10.000Z\nlabels:\n  - Bug\nnumber: 1\npriority: 2\nproject: cm0proj000000000000000001\nstate: blocked\ntitle: 'Plan: Q1 / \"launch\"?'\nupdated: 2026-11-20T09:00:00.000Z\ndue: 2026-11-28\n---\nThe description.\n\n- [ ] a step\n" },
  { path: 'tasks/cm0task000000000000000002.md', text: '---\ncreated: 2026-11-19T16:45:00.000Z\nnumber: 2\nparent_id: cm0task000000000000000001\nproject: cm0proj000000000000000001\nstate: done\ntitle: A subtask\n---\n' },
  { path: 'tasks/cm0task000000000000000003.md', text: '---\ncreated: 2026-11-19T17:00:00.000Z\nnumber: 1\nstate: todo\ntitle: Loose task\n---\n' },
  { path: 'tasks/.archive/cm0task000000000000000004.md', text: '---\ncreated: 2026-10-01T10:00:00.000Z\nnumber: 3\nproject: cm0proj000000000000000001\nstate: cancelled\ntitle: Old idea\n---\n' },
  { path: 'tasks/activity/cm0task000000000000000001.json', text: JSON.stringify({ events: [{ type: 'created', at: '2026-11-19T16:42:10Z' }, { type: 'state_changed', at: '2026-11-20T09:00:00Z', from: 'todo', to: 'blocked' }, { type: 'comment', at: '2026-11-20T09:05:00Z', body: 'Waiting on the designer.' }] }) },
]

describe('importing an Octarine workspace', () => {
  const { workspace: ws, warnings } = importOctarine(files, '2026-11-25T10:00Z')

  it('brings over projects, statuses, labels and tasks with their IDs', () => {
    expect(warnings).toEqual([])
    expect(ws.projects).toHaveLength(1)
    expect(ws.projects[0]).toMatchObject({ name: 'Website', key: 'WEB', status: 'in-progress', icon: 'globe', color: '#8C7DA8', target: '2026-12-15', description: 'Relaunch the site.', next: 4 })
    expect(ws.statuses.find((s) => s.name === 'Blocked')).toMatchObject({ category: 'started', color: '#F4D35E' })
    const [plan, sub, loose, old] = ws.tasks
    expect(identifier(ws, plan)).toBe('WEB-1')
    expect(plan).toMatchObject({ title: 'Plan: Q1 / "launch"?', priority: 2, labels: ['Bug'], due: '2026-11-28', status: 'blocked', description: 'The description.\n\n- [ ] a step' })
    expect(sub.parent).toBe(plan.id)
    expect(sub.completed).toBeDefined()
    expect(identifier(ws, loose)).toBe('TASK-1')
    expect(old.archived).toBeDefined()
  })

  it('keeps history and comments', () => {
    const plan = ws.tasks[0]
    expect(plan.history.map((h) => h.kind)).toEqual(['created', 'status', 'comment'])
    expect(plan.history[1]).toMatchObject({ from: 'Todo', to: 'Blocked' })
    expect(plan.history[2].text).toBe('Waiting on the designer.')
  })

  it('writes a note Tasks reads back the same', () => {
    const text = writeNote(ws)
    const back = readNote(text)
    expect(back.warnings).toEqual([])
    expect(back.workspace.tasks.map((t) => t.title).sort()).toEqual(ws.tasks.map((t) => t.title).sort())
    expect(writeNote(back.workspace)).toBe(text)
  })
})
