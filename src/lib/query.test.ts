import { describe, expect, it } from 'vitest'
import { demoWorkspace } from '../sample/demo'
import { identifier } from './model/workspace'
import { compareTasks, dueBucket, filterTasks, formatTerm, parseQuery, upNext } from './query'

const NOW = new Date('2026-11-24T12:00:00').getTime()
const ws = demoWorkspace()
const ids = (query: string) =>
  filterTasks(ws, ws.tasks, query, NOW)
    .map((t) => identifier(ws, t))
    .sort()

describe('parsing', () => {
  it('splits words, terms, negation, OR lists and an ID', () => {
    const q = parseQuery('fix sync status:todo,in_progress -label:"needs design" p:1 WEB-12')
    expect(q.text).toBe('fix sync')
    expect(q.ticket).toBe('WEB-12')
    expect(q.terms).toEqual([
      { key: 'status', values: ['todo', 'in-progress'], negate: false },
      { key: 'label', values: ['needs design'], negate: true },
      { key: 'priority', values: ['urgent'], negate: false },
    ])
  })

  it('leaves unknown keys as words', () => {
    expect(parseQuery('foo:bar').text).toBe('foo:bar')
  })

  it('writes terms back', () => {
    expect(formatTerm({ key: 'label', values: ['a b', 'c'], negate: true })).toBe('-label:"a b",c')
  })
})

describe('filtering the demo workspace (today is 24 Nov)', () => {
  it('status and priority', () => {
    expect(ids('status:todo')).toEqual(['FIN-2', 'HOME-4', 'TASK-2', 'TASK-3', 'WEB-11', 'WEB-16', 'WEB-9'])
    expect(ids('priority:urgent,high')).toEqual(['FIN-2', 'HOME-4', 'TASK-3', 'WEB-12', 'WEB-14', 'WEB-17', 'WEB-5'])
    expect(ids('status:waiting')).toEqual(['HOME-6'])
  })

  it('labels, with exclusion', () => {
    expect(ids('label:docs -label:design')).toEqual(['WEB-12'])
  })

  it('due dates', () => {
    expect(ids('is:overdue')).toEqual(['WEB-11'])
    expect(ids('due:today')).toEqual(['TASK-3'])
    expect(ids('is:open due:<7d')).toEqual(['HOME-4', 'TASK-2', 'TASK-3', 'WEB-11', 'WEB-12', 'WEB-14', 'WEB-17'])
    expect(ids('due:none status:backlog')).toEqual(['WEB-18', 'WEB-7'])
  })

  it('completed recently', () => {
    expect(ids('completed:<7d')).toEqual(['FIN-4', 'WEB-15', 'WEB-5'])
  })

  it('IDs, words, spaces, projects, structure, comments and custom fields', () => {
    expect(ids('WEB-12')).toEqual(['WEB-12'])
    expect(ids('#12')).toEqual(['WEB-12'])
    expect(ids('signup')).toEqual(['WEB-14', 'WEB-15', 'WEB-17'])
    expect(ids('space:home-life')).toEqual(['HOME-4', 'HOME-6', 'TASK-2'])
    expect(ids('project:web is:subtask')).toEqual(['WEB-15', 'WEB-17'])
    expect(ids('is:parent')).toEqual(['WEB-14'])
    expect(ids('has:comments')).toEqual(['WEB-14'])
    expect(ids('effort:m')).toEqual(['WEB-11'])
    expect(ids('bucket:now')).toEqual(['HOME-4'])
  })

  it('hides archived tasks unless asked', () => {
    const copy = demoWorkspace()
    copy.tasks[0].archived = '2026-11-24T10:00Z'
    expect(filterTasks(copy, copy.tasks, 'signup', NOW).map((t) => identifier(copy, t))).toEqual(['WEB-15', 'WEB-17'])
    expect(filterTasks(copy, copy.tasks, 'is:archived', NOW).map((t) => identifier(copy, t))).toEqual(['WEB-14'])
  })
})

describe('ordering and buckets', () => {
  it('sorts by priority, urgent first and none last, with manual order breaking ties', () => {
    const sorted = [...ws.tasks].filter((t) => t.project === 'website' && !t.parent).sort(compareTasks(ws, 'priority', 'asc'))
    expect(sorted.map((t) => identifier(ws, t))).toEqual(['WEB-14', 'WEB-5', 'WEB-12', 'WEB-7', 'WEB-11', 'WEB-9', 'WEB-3', 'WEB-16', 'WEB-18'])
  })

  it('puts in-progress work first in Up next', () => {
    expect(upNext(ws, ws.tasks).slice(0, 4).map((t) => identifier(ws, t))).toEqual(['WEB-14', 'WEB-17', 'WEB-12', 'HOME-6'])
  })

  it('groups due dates like Octarine', () => {
    const bucket = (id: string) => dueBucket(ws, ws.tasks.find((t) => identifier(ws, t) === id)!, NOW)
    expect([bucket('WEB-11'), bucket('TASK-3'), bucket('WEB-12'), bucket('WEB-9'), bucket('WEB-16')]).toEqual(['overdue', 'today', 'week', 'later', 'none'])
  })
})
