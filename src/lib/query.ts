/**
 * The search-and-filter language, as Octarine's task search works:
 *   status:todo priority:urgent,high label:docs due:<7d -label:bug is:overdue "exact words" WEB-12
 * key:value terms must all match (AND); commas inside a value mean OR; a leading minus excludes;
 * quotes keep spaces; a lone ID (WEB-12, #12, or an old ID) narrows to that task; other words must
 * all appear in the title, description, comments or ID. Archived tasks only with is:archived.
 * Beyond Octarine: project:web, custom fields by name (effort:l), and due:this-week / due:next-week,
 * whose weeks start on the day chosen in Settings.
 */
import { CATEGORIES, PRIORITY_NAMES, PRIORITY_ORDER } from './model/defaults'
import type { Task, Workspace } from './model/types'
import { childrenOf, identifier, isClosed, manualOrder, nextWeekStart, orderedStatuses, projectOf, spaceIdOf, statusOf } from './model/workspace'

export const KEYS = ['status', 'priority', 'label', 'type', 'bucket', 'cycle', 'space', 'project', 'is', 'has', 'due', 'created', 'completed'] as const
export type Key = (typeof KEYS)[number] | `field:${string}`

const KEY_ALIASES: Record<string, Key> = { state: 'status', labels: 'label', tag: 'label', tags: 'label', p: 'priority', spaces: 'space', area: 'space' }

const VALUE_ALIASES: Partial<Record<Key, Record<string, string>>> = {
  status: { in_progress: 'in-progress', inprogress: 'in-progress', progress: 'in-progress', started: 'in-progress', in_review: 'in-review', inreview: 'in-review', review: 'in-review', canceled: 'cancelled', complete: 'done', completed: 'done' },
  priority: { 0: 'none', 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' },
  is: { active: 'open', completed: 'closed', done: 'closed', child: 'subtask', sub: 'subtask' },
  has: { comment: 'comments', subtask: 'subtasks', children: 'subtasks', label: 'labels' },
  due: { past: 'overdue', week: 'this-week', thisweek: 'this-week', nextweek: 'next-week' },
  cycle: { active: 'current', now: 'current', next: 'upcoming', last: 'previous', prev: 'previous' },
}

export const KEY_HINTS: Record<(typeof KEYS)[number], string> = {
  status: 'Backlog, todo, in progress…',
  priority: 'Urgent, high, medium, low, none',
  label: 'Label name',
  type: 'Type name, or none',
  bucket: 'Bucket name, or none',
  cycle: 'current, upcoming, previous, none',
  space: 'Space name, or none',
  project: 'Project key or name, or none',
  is: 'open, closed, overdue, parent, subtask',
  has: 'due, labels, comments, subtasks',
  due: 'overdue, today, this-week, next-week, <7d',
  created: 'Age, e.g. <7d',
  completed: 'Time since done, e.g. <7d',
}

export const FIXED_VALUES: Partial<Record<(typeof KEYS)[number], string[]>> = {
  priority: ['urgent', 'high', 'medium', 'low', 'none'],
  is: ['open', 'closed', 'overdue', 'archived', 'parent', 'subtask'],
  has: ['due', 'labels', 'description', 'comments', 'subtasks', 'parent', 'priority', 'type', 'bucket', 'cycle', 'space'],
  cycle: ['current', 'upcoming', 'previous', 'none'],
  due: ['overdue', 'today', 'this-week', 'next-week', '<7d', '<30d', 'none'],
  created: ['<1d', '<7d', '<30d', '>30d'],
  completed: ['<1d', '<7d', '<30d', '>30d'],
}

export interface Term {
  key: Key
  values: string[]
  negate: boolean
}

export interface Query {
  text: string
  ticket: string | null
  terms: Term[]
}

/** Lower case, spaces to hyphens: how names are written in a query (In progress → in-progress). */
export const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-')

const TOKENS = /(-?[\w-]+:"[^"]*"|"[^"]*"|\S+)/g
const unquote = (s: string) => s.replace(/^"|"$/g, '')

/** Field keys a query may use: the workspace's custom fields by slug. */
export function fieldKeys(ws: Workspace): Map<string, string> {
  return new Map(ws.fields.map((f) => [slug(f.name), f.id]))
}

export function parseQuery(input: string, fields: Map<string, string> = new Map()): Query {
  const text: string[] = []
  const terms: Term[] = []
  let ticket: string | null = null
  for (const token of input.match(TOKENS) ?? []) {
    if (ticket === null && /^(?:[a-z][a-z0-9]{1,4}-|#)\d+$/i.test(token)) {
      ticket = token.toUpperCase()
      continue
    }
    const m = /^(-?)([a-zA-Z_][\w-]*):(.+)$/.exec(token)
    const rawKey = m?.[2].toLowerCase()
    const key: Key | null = !rawKey
      ? null
      : (KEYS as readonly string[]).includes(rawKey)
        ? (rawKey as Key)
        : (KEY_ALIASES[rawKey] ?? (fields.has(rawKey) ? (`field:${fields.get(rawKey)}` as Key) : null))
    if (!m || !key) {
      text.push(unquote(token))
      continue
    }
    const values = unquote(m[3])
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => (key === 'label' || key.startsWith('field:') ? v : (VALUE_ALIASES[key]?.[v.toLowerCase()] ?? v.toLowerCase())))
    if (values.length) terms.push({ key, values, negate: m[1] === '-' })
  }
  return { text: text.join(' ').trim(), ticket, terms }
}

/** Writes a term back as text (for chips). */
export function formatTerm(term: Term, fieldName?: string): string {
  const key = term.key.startsWith('field:') ? slug(fieldName ?? term.key.slice(6)) : term.key
  return `${term.negate ? '-' : ''}${key}:${term.values.map((v) => (/\s/.test(v) ? `"${v}"` : v)).join(',')}`
}

const DAY = 86_400_000

function localMidnight(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dueTime(task: Task): number | null {
  if (!task.due) return null
  const t = new Date(`${task.due}T00:00:00`).getTime()
  return Number.isNaN(t) ? null : t
}

/** "<7d", ">30d", "<12h", "<2w", "<1m" (a month is 30 days) → op and days. */
function span(v: string): { op: '<' | '>'; days: number } | null {
  const m = /^(<|>)?(\d+)([hdwm])$/.exec(v.trim())
  if (!m) return null
  const unit = { h: 1 / 24, d: 1, w: 7, m: 30 }[m[3] as 'h' | 'd' | 'w' | 'm']
  return { op: (m[1] || '<') as '<' | '>', days: Number(m[2]) * unit }
}

export function isOverdue(ws: Workspace, task: Task, now: number): boolean {
  const due = dueTime(task)
  return due !== null && due < localMidnight(now) && !isClosed(ws, task) && !task.archived
}

export type DueBucket = 'overdue' | 'past' | 'today' | 'week' | 'later' | 'none'

/** Octarine's due-date groups: Overdue, Past (due before today but closed), Today, This week, Later, No due date. */
export function dueBucket(ws: Workspace, task: Task, now: number): DueBucket {
  const due = dueTime(task)
  if (due === null) return 'none'
  const today = localMidnight(now)
  if (due < today) return isOverdue(ws, task, now) ? 'overdue' : 'past'
  if (due === today) return 'today'
  return due < nextWeekStart(new Date(now), ws.settings.weekStart).getTime() ? 'week' : 'later'
}

export interface MatchContext {
  ws: Workspace
  now: number
  /** Ids of tasks that have (non-archived) subtasks. */
  parents: Set<string>
}

export function matchContext(ws: Workspace, now = Date.now()): MatchContext {
  const parents = new Set<string>()
  for (const t of ws.tasks) if (t.parent && !t.archived) parents.add(t.parent)
  return { ws, now, parents }
}

function cycleMatches(ctx: MatchContext, task: Task, v: string): boolean {
  const cycle = task.cycle ? ctx.ws.cycles.find((c) => c.id === task.cycle) : undefined
  if (v === 'none') return !cycle
  if (!cycle) return false
  if (v === 'current') return cycle.state === 'active'
  if (v === 'upcoming') return cycle.state === 'upcoming'
  if (v === 'previous') {
    const ended = ctx.ws.cycles.filter((c) => c.state === 'ended').sort((a, b) => b.end.localeCompare(a.end))[0]
    return ended?.id === cycle.id
  }
  if (/^\d+$/.test(v)) return cycle.number === Number(v)
  return slug(cycle.name ?? '') === v
}

function termMatches(ctx: MatchContext, task: Task, key: Key, v: string): boolean {
  const { ws, now } = ctx
  if (key.startsWith('field:')) {
    const value = (task.fields[key.slice(6)] ?? '').toLowerCase()
    const want = v.toLowerCase()
    if (want === 'none') return !value
    return value === want || value.split(/[,\n]/).map((s) => s.trim()).includes(want) || (want.length > 2 && value.includes(want))
  }
  switch (key) {
    case 'status': {
      const s = statusOf(ws, task.status)
      return s.id === v || slug(s.name) === v
    }
    case 'priority':
      return slug(PRIORITY_NAMES[task.priority]) === v || (v === 'none' && task.priority === 0)
    case 'label':
      return task.labels.some((l) => l.toLowerCase() === v.toLowerCase())
    case 'type': {
      const type = ws.types.find((t) => t.id === task.type)
      return v === 'none' ? !type : !!type && slug(type.name) === v
    }
    case 'bucket': {
      const bucket = ws.buckets.find((b) => b.id === task.bucket)
      return v === 'none' ? !bucket : !!bucket && slug(bucket.name) === v
    }
    case 'cycle':
      return cycleMatches(ctx, task, v)
    case 'space': {
      const id = spaceIdOf(ws, task)
      const space = id ? ws.spaces.find((s) => s.id === id) : undefined
      return v === 'none' ? !space : !!space && slug(space.name) === v
    }
    case 'project': {
      const project = projectOf(ws, task)
      return v === 'none' ? !project : !!project && (project.key.toLowerCase() === v || slug(project.name) === v)
    }
    case 'is':
      switch (v) {
        case 'open': return !isClosed(ws, task)
        case 'closed': return isClosed(ws, task)
        case 'overdue': return isOverdue(ws, task, now)
        case 'archived': return !!task.archived
        case 'parent': return ctx.parents.has(task.id)
        case 'subtask': return !!task.parent
        default: return false
      }
    case 'has':
      switch (v) {
        case 'due': return !!task.due
        case 'labels': return task.labels.length > 0
        case 'description': return task.description.trim().length > 0
        case 'comments': return task.history.some((h) => h.kind === 'comment')
        case 'subtasks': return ctx.parents.has(task.id)
        case 'parent': return !!task.parent
        case 'priority': return task.priority > 0
        case 'type': return !!ws.types.find((t) => t.id === task.type)
        case 'bucket': return !!ws.buckets.find((b) => b.id === task.bucket)
        case 'cycle': return !!task.cycle && ws.cycles.some((c) => c.id === task.cycle)
        case 'space': return !!spaceIdOf(ws, task)
        default: return false
      }
    case 'due': {
      const due = dueTime(task)
      if (v === 'none') return due === null
      if (due === null) return false
      if (v === 'overdue') return isOverdue(ws, task, now)
      const today = localMidnight(now)
      if (v === 'today') return due === today
      // By the end of this week (overdue included), or within next week; weeks start on the workspace's day.
      const next = nextWeekStart(new Date(now), ws.settings.weekStart)
      if (v === 'this-week') return due < next.getTime()
      if (v === 'next-week') {
        const after = new Date(next)
        after.setDate(after.getDate() + 7)
        return due >= next.getTime() && due < after.getTime()
      }
      const s = span(v)
      if (!s) return false
      return s.op === '<' ? due < today + s.days * DAY : due >= today + s.days * DAY
    }
    case 'created':
    case 'completed': {
      const stamp = key === 'created' ? task.created : task.completed
      if (!stamp || (key === 'completed' && statusOf(ws, task.status).category !== 'completed')) return false
      const age = (now - new Date(stamp).getTime()) / DAY
      const s = span(v)
      if (!s || Number.isNaN(age)) return false
      return s.op === '<' ? age < s.days : age > s.days
    }
  }
  return false
}

function haystack(ws: Workspace, task: Task): string {
  return [task.title, task.description, ...task.history.filter((h) => h.kind === 'comment').map((h) => h.text ?? ''), identifier(ws, task), ...task.aliases]
    .join(' ')
    .toLowerCase()
}

export function matches(ctx: MatchContext, task: Task, query: Query): boolean {
  const wantsArchived = query.terms.some((t) => t.key === 'is' && !t.negate && t.values.includes('archived'))
  if (task.archived && !wantsArchived) return false
  if (query.ticket) {
    const t = query.ticket
    const hit = t.startsWith('#') ? task.number === Number(t.slice(1)) : identifier(ctx.ws, task) === t || task.aliases.some((a) => a.toUpperCase() === t)
    if (!hit) return false
  }
  if (query.text) {
    const hay = haystack(ctx.ws, task)
    if (!query.text.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false
  }
  return query.terms.every((term) => {
    const any = term.values.some((v) => termMatches(ctx, task, term.key, v))
    return term.negate ? !any : any
  })
}

export function filterTasks(ws: Workspace, tasks: Task[], input: string, now = Date.now()): Task[] {
  const query = parseQuery(input, fieldKeys(ws))
  const ctx = matchContext(ws, now)
  return tasks.filter((t) => matches(ctx, t, query))
}

export type Ordering = 'manual' | 'status' | 'priority' | 'type' | 'due' | 'created' | 'updated'
export type Direction = 'asc' | 'desc'

/** Sorts like Octarine: the chosen ordering, then manual order, then id (the tie-break never reverses). */
export function compareTasks(ws: Workspace, ordering: Ordering, direction: Direction): (a: Task, b: Task) => number {
  const statuses = orderedStatuses(ws).map((s) => s.id)
  const typeIndex = (t: Task) => {
    const i = ws.types.findIndex((x) => x.id === t.type)
    return i < 0 ? Infinity : i
  }
  const time = (s?: string) => (s ? new Date(s).getTime() || 0 : 0)
  return (a, b) => {
    let d = 0
    switch (ordering) {
      case 'status': d = statuses.indexOf(statusOf(ws, a.status).id) - statuses.indexOf(statusOf(ws, b.status).id); break
      case 'priority': d = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority); break
      case 'type': d = typeIndex(a) - typeIndex(b); break
      case 'due': d = (dueTime(a) ?? Infinity) - (dueTime(b) ?? Infinity); break
      case 'created': d = time(a.created) - time(b.created); break
      case 'updated': d = time(a.updated) - time(b.updated); break
    }
    if (Number.isNaN(d)) d = 0
    if (direction === 'desc' && ordering !== 'manual') d = -d
    return d || manualOrder(a) - manualOrder(b) || a.id.localeCompare(b.id)
  }
}

/** "Up next": in progress and in review first, then by due date, priority and number. */
export function upNext(ws: Workspace, tasks: Task[]): Task[] {
  const rank = (t: Task) => (['started', 'review'].includes(statusOf(ws, t.status).category) ? 0 : 1)
  const prio = (t: Task) => t.priority || 5
  return tasks
    .filter((t) => !t.archived && !isClosed(ws, t))
    .sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || prio(a) - prio(b) || a.number - b.number)
}

/** Values to suggest after "key:" for the live workspace. */
export function suggestValues(ws: Workspace, key: string): { value: string; label: string }[] {
  const k = (KEY_ALIASES[key] ?? key) as Key
  switch (k) {
    case 'status':
      return orderedStatuses(ws).map((s) => ({ value: s.builtin ? s.id : slug(s.name), label: s.name }))
    case 'label':
      return [...new Set([...ws.labels.map((l) => l.name), ...ws.tasks.flatMap((t) => t.labels)])].sort().map((l) => ({ value: l, label: l }))
    case 'type':
      return [...ws.types.map((t) => ({ value: slug(t.name), label: t.name })), { value: 'none', label: 'No type' }]
    case 'bucket':
      return [...ws.buckets.map((b) => ({ value: slug(b.name), label: b.name })), { value: 'none', label: 'No bucket' }]
    case 'space':
      return [...ws.spaces.map((s) => ({ value: slug(s.name), label: s.name })), { value: 'none', label: 'No space' }]
    case 'project':
      return [...ws.projects.map((p) => ({ value: p.key.toLowerCase(), label: p.name })), { value: 'none', label: 'No project' }]
    default:
      return (FIXED_VALUES[k as keyof typeof FIXED_VALUES] ?? []).map((v) => ({ value: v, label: v }))
  }
}

/** Open tasks under a parent (for "Complete subtasks too?"). */
export function openChildren(ws: Workspace, task: Task): Task[] {
  return childrenOf(ws, task).filter((t) => !isClosed(ws, t))
}

export { CATEGORIES }
