import { describe, expect, it } from 'vitest'
import { demoWorkspace } from '../sample/demo'
import { findByIdentifier } from './model/workspace'
import { run } from './ops'
import { addField, addStatus, deleteBucket, deleteField, deleteLabel, deleteStatus, deleteType, fieldNameProblem, setNoProjectKey, updateLabel } from './settingsOps'

const T = '2026-11-25T10:00Z'

describe('workspace settings', () => {
  it('adds a custom status inside a category and deletes it back to the built-in', () => {
    const ws = demoWorkspace()
    let next = run(ws, 'a', (d) => void addStatus(d, 'Blocked', 'started'), T).ws
    expect(next.statuses.find((s) => s.name === 'Blocked')).toMatchObject({ id: 'blocked', category: 'started', builtin: false })
    // The demo's Waiting status (started) has HOME-6; deleting it moves the task to In progress.
    next = run(next, 'b', (d) => deleteStatus(d, 'waiting'), T).ws
    expect(findByIdentifier(next, 'HOME-6')!.status).toBe('in-progress')
    expect(next.statuses.some((s) => s.id === 'waiting')).toBe(false)
  })

  it('renames a label on every task', () => {
    const ws = demoWorkspace()
    const next = run(ws, 'a', (d) => updateLabel(d, 'Docs', { name: 'Writing' }), T).ws
    expect(findByIdentifier(next, 'WEB-12')!.labels).toEqual(['Writing'])
    expect(next.labels.some((l) => l.name === 'Writing')).toBe(true)
    expect(next.labels.some((l) => l.name === 'Docs')).toBe(false)
  })

  it('deletes labels, types and buckets from tasks', () => {
    const ws = demoWorkspace()
    let next = run(ws, 'a', (d) => deleteLabel(d, 'design'), T).ws
    expect(findByIdentifier(next, 'WEB-11')!.labels).toEqual(['Docs'])
    next = run(next, 'b', (d) => deleteBucket(d, 'now'), T).ws
    expect(findByIdentifier(next, 'HOME-4')!.bucket).toBeUndefined()
    const typed = run(next, 'c', (d) => {
      const t = d.ws.tasks[0]
      d.putTask({ ...t, type: 'bug' })
    }, T).ws
    next = run(typed, 'd', (d) => deleteType(d, 'bug'), T).ws
    expect(next.tasks[0].type).toBeUndefined()
  })

  it('checks field names and removes a field’s values', () => {
    const ws = demoWorkspace()
    expect(fieldNameProblem('Status', ws.fields)).toMatch(/built-in/)
    expect(fieldNameProblem('Effort', ws.fields)).toMatch(/already/)
    expect(fieldNameProblem('Story points', ws.fields)).toBeNull()
    let next = run(ws, 'a', (d) => void addField(d, { name: 'Story points', type: 'number', options: [] }), T).ws
    expect(next.fields.map((f) => f.id)).toEqual(['effort', 'story-points'])
    next = run(next, 'b', (d) => deleteField(d, 'effort'), T).ws
    expect(findByIdentifier(next, 'WEB-14')!.fields).toEqual({})
  })

  it('changes the No-project key and keeps the old IDs', () => {
    const ws = demoWorkspace()
    const next = run(ws, 'a', (d) => setNoProjectKey(d, 'INBOX'), T).ws
    expect(next.settings.noProjectKey).toBe('INBOX')
    expect(findByIdentifier(next, 'TASK-3')?.title).toBe('Call the bank about the card')
    expect(findByIdentifier(next, 'INBOX-3')?.title).toBe('Call the bank about the card')
  })
})
