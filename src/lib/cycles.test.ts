import { describe, expect, it } from 'vitest'
import { demoWorkspace } from '../sample/demo'
import { findByIdentifier } from './model/workspace'
import { completeCycle, cycleName, cycleTime, ensureCycles, readyToClose } from './cycles'
import { patchTask, run } from './ops'

const T = '2026-11-25T10:00Z'

describe('cycles', () => {
  it('turning cycles on makes an active and an upcoming cycle from the start weekday', () => {
    const ws = demoWorkspace()
    ws.cycleSettings = { enabled: true, weeks: 2, startDay: 0 }
    const next = run(ws, 'on', (d) => ensureCycles(d, '2026-11-25'), T).ws
    // Wednesday 25 Nov → the cycle started Monday 23 Nov and runs two weeks.
    expect(next.cycles.map((c) => [c.number, c.start, c.end, c.state])).toEqual([
      [1, '2026-11-23', '2026-12-06', 'active'],
      [2, '2026-12-07', '2026-12-20', 'upcoming'],
    ])
    expect(cycleName(next.cycles[1])).toBe('Upcoming cycle')
    expect(cycleTime(next.cycles[0], '2026-11-25')).toBe('Day 3 of 14 · 11 days left')
    expect(readyToClose(next.cycles[0], '2026-12-07')).toBe(true)
  })

  it('completing a cycle carries chosen work forward, returns the rest and keeps stats', () => {
    const ws = demoWorkspace()
    ws.cycleSettings = { enabled: true, weeks: 1, startDay: 0 }
    let next = run(ws, 'on', (d) => ensureCycles(d, '2026-11-25'), T).ws
    const a = findByIdentifier(next, 'WEB-11')!.id
    const b = findByIdentifier(next, 'WEB-16')!.id
    const c = findByIdentifier(next, 'WEB-5')!.id
    next = run(next, 'plan', (d) => [a, b, c].forEach((id) => patchTask(d, id, { cycle: '1' })), T).ws
    next = run(next, 'complete', (d) => completeCycle(d, '1', { [a]: '2', [b]: null }), T).ws
    const ended = next.cycles.find((x) => x.id === '1')!
    expect(ended.state).toBe('ended')
    expect(ended.stats).toMatchObject({ completed: 1, carried: 1, returned: 1 })
    expect(findByIdentifier(next, 'WEB-11')!.cycle).toBe('2')
    expect(findByIdentifier(next, 'WEB-16')!.cycle).toBeUndefined()
    expect(next.cycles.find((x) => x.id === '2')).toMatchObject({ state: 'active', planned: [a] })
    expect(next.cycles.find((x) => x.id === '3')?.state).toBe('upcoming')
  })
})
