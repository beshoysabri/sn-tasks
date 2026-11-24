/**
 * Cycles as in Octarine: repeating time boxes of 1–4 weeks from a chosen weekday. Turning cycles on
 * makes a numbered active cycle and an "Upcoming cycle"; tasks are added by hand. There is no
 * auto-close: an active cycle past its end is "Ready to close", and completing it decides where
 * unfinished work goes, records its stats, promotes the upcoming cycle and makes the next one.
 */
import type { Cycle, CycleStats, Task, Workspace } from './model/types'
import { isClosed, statusOf, today } from './model/workspace'
import { patchTask, type Draft } from './ops'

const DAY = 86_400_000

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return today(d)
}

/** The most recent start weekday on or before a date (0 = Monday). */
function lastStart(iso: string, startDay: number): string {
  const d = new Date(`${iso}T00:00:00`)
  const weekday = (d.getDay() + 6) % 7
  return addDays(iso, -((weekday - startDay + 7) % 7))
}

export function cycleName(c: Cycle): string {
  if (c.state === 'upcoming' && !c.name) return 'Upcoming cycle'
  return c.name ?? `Cycle ${c.number}`
}

export function cycleRange(c: Cycle): string {
  const f = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${f(c.start)} – ${f(c.end)}`
}

export function readyToClose(c: Cycle, todayIso: string): boolean {
  return c.state === 'active' && c.end < todayIso
}

/** "Day 3 of 14 · 11 days left", "Starts in 2 days", "Ended". */
export function cycleTime(c: Cycle, todayIso: string): string {
  if (c.state === 'ended') return 'Ended'
  const start = new Date(`${c.start}T00:00:00`).getTime()
  const end = new Date(`${c.end}T00:00:00`).getTime()
  const now = new Date(`${todayIso}T00:00:00`).getTime()
  const total = Math.round((end - start) / DAY) + 1
  if (now < start) {
    const n = Math.round((start - now) / DAY)
    return n === 0 ? 'Starts today' : `Starts in ${n} day${n === 1 ? '' : 's'}`
  }
  const day = Math.round((now - start) / DAY) + 1
  if (day > total) return 'Ready to close'
  const left = total - day
  return left === 0 ? 'Last day' : `Day ${day} of ${total} · ${left} day${left === 1 ? '' : 's'} left`
}

/** Makes sure an active and an upcoming cycle exist while cycles are on. */
export function ensureCycles(d: Draft, todayIso = today()) {
  const ws = d.ws
  if (!ws.cycleSettings.enabled) return
  const length = ws.cycleSettings.weeks * 7
  const cycles = [...ws.cycles]
  let active = cycles.find((c) => c.state === 'active')
  const maxNumber = cycles.reduce((m, c) => Math.max(m, c.number), 0)
  if (!active) {
    const start = lastStart(todayIso, ws.cycleSettings.startDay)
    active = { id: String(maxNumber + 1), number: maxNumber + 1, start, end: addDays(start, length - 1), state: 'active', planned: [] }
    cycles.push(active)
  }
  if (!cycles.some((c) => c.state === 'upcoming')) {
    const n = cycles.reduce((m, c) => Math.max(m, c.number), 0) + 1
    const start = addDays(active.end, 1)
    cycles.push({ id: String(n), number: n, start, end: addDays(start, length - 1), state: 'upcoming', planned: [] })
  }
  if (cycles.length !== ws.cycles.length) d.set('cycles', cycles)
}

/** Completes a cycle: each unfinished task goes to the chosen cycle (or none), stats are kept. */
export function completeCycle(d: Draft, cycleId: string, destinations: Record<string, string | null>) {
  const ws = d.ws
  const cycle = ws.cycles.find((c) => c.id === cycleId)
  if (!cycle || cycle.state !== 'active') return
  const inCycle = ws.tasks.filter((t) => t.cycle === cycleId && !t.archived)
  const category = (t: Task) => statusOf(ws, t.status).category
  const unfinished = inCycle.filter((t) => !isClosed(ws, t))
  let carried = 0
  let returned = 0
  for (const t of unfinished) {
    const to = destinations[t.id] ?? null
    if (to) carried++
    else returned++
    patchTask(d, t.id, { cycle: to ?? undefined }, false)
  }
  const stats: CycleStats = {
    planned: cycle.planned.length,
    plannedCompleted: inCycle.filter((t) => cycle.planned.includes(t.id) && category(t) === 'completed').length,
    completed: inCycle.filter((t) => category(t) === 'completed').length,
    cancelled: inCycle.filter((t) => category(t) === 'cancelled').length,
    added: inCycle.filter((t) => !cycle.planned.includes(t.id)).length,
    carried,
    returned,
  }
  const length = ws.cycleSettings.weeks * 7
  let cycles = d.ws.cycles.map((c) => (c.id === cycleId ? { ...c, state: 'ended' as const, name: c.name ?? `Cycle ${c.number}`, stats } : c))
  const upcoming = cycles.filter((c) => c.state === 'upcoming').sort((a, b) => a.start.localeCompare(b.start))[0]
  if (upcoming) {
    const planned = d.ws.tasks.filter((t) => t.cycle === upcoming.id).map((t) => t.id)
    cycles = cycles.map((c) => (c.id === upcoming.id ? { ...c, state: 'active' as const, planned } : c))
    const n = cycles.reduce((m, c) => Math.max(m, c.number), 0) + 1
    const start = addDays(upcoming.end, 1)
    cycles.push({ id: String(n), number: n, start, end: addDays(start, length - 1), state: 'upcoming', planned: [] })
  }
  d.set('cycles', cycles)
}

export function openCount(ws: Workspace, cycleId: string): number {
  return ws.tasks.filter((t) => t.cycle === cycleId && !t.archived && !isClosed(ws, t)).length
}
