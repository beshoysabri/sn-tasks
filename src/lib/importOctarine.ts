/**
 * One-time import of an Octarine workspace's tasks (its `.octarine` folder) into a Tasks workspace.
 * Octarine keeps each task, project, space, cycle, status, label, type, bucket and saved filter as a
 * Markdown file with YAML front matter under `.octarine/tasks` (tasks at the top, the rest in folders
 * named after their kind, archived ones in `.archive`), and comments and history in `tasks/activity`.
 * The reader is tolerant: unknown fields are skipped, what it can't read is reported.
 * Used by scripts/import-octarine.ts; never part of the app bundle.
 */
import { parse as parseYaml } from 'yaml'
import { BUILTIN_STATUSES, CATEGORIES, emptyWorkspace } from './model/defaults'
import type { HistoryEntry, Priority, ProjectStatus, StatusCategory, Task, Workspace } from './model/types'
import { deriveKey, newId, normaliseLabel } from './model/workspace'

export interface SourceFile {
  /** Path inside the `.octarine` folder, e.g. `tasks/abc.md`, `tasks/projects/xyz.md`. */
  path: string
  text: string
}

const COLOURS: Record<string, string> = {
  blue: '#81B2D9', sky: '#A0C5E3', teal: '#32769B', cyan: '#A0C5E3', green: '#62866C', lime: '#B4CFA4', emerald: '#8BA47C',
  yellow: '#F4D35E', amber: '#F4D35E', orange: '#FF9C5B', coral: '#E39B99', red: '#CB7876', rose: '#E39B99', pink: '#FBC2C2',
  purple: '#8C7DA8', violet: '#BBA6DD', indigo: '#64557B', brown: '#CB7876', azure: '#A0C5E3', magenta: '#E39B99', fuchsia: '#E39B99',
}

const colour = (v: unknown) => (typeof v === 'string' ? (/^#[0-9a-f]{3,8}$/i.test(v) ? v.toUpperCase() : COLOURS[v.toLowerCase()]) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined)
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])
const prio = (v: unknown): Priority => {
  const n = Number(v)
  return [0, 1, 2, 3, 4].includes(n) ? (n as Priority) : 0
}
/** Octarine writes ISO times; the note keeps UTC minutes. */
const stamp = (v: unknown, fallback: string) => {
  const t = typeof v === 'string' || v instanceof Date ? new Date(v as string) : null
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 16) + 'Z' : fallback
}
const date = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined
}
const HEROICONS: Record<string, string> = {
  'academic-cap': 'graduation-cap', 'calendar-date-range': 'calendar-range', 'check-circle': 'circle-check', 'circle-stack': 'database',
  'code-bracket': 'code', 'cube': 'box', 'globe-alt': 'globe', 'light-bulb': 'lightbulb', 'musical-note': 'music', 'paper-airplane': 'plane',
  'rocket-launch': 'rocket', 'server-stack': 'server', 'cpu-chip': 'cpu', 'bug-ant': 'bug', 'document-text': 'file-text', 'folder-open': 'folder',
  'user-group': 'users', 'home-modern': 'home', 'shopping-bag': 'shopping-cart', 'chart-bar': 'chart-column', 'wrench-screwdriver': 'wrench',
}
/** lucide:CalendarDays, CalendarDays or a Heroicons name (AcademicCapIcon) → calendar-days, graduation-cap */
const icon = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim()) return undefined
  const hero = /Icon$/.test(v) && !v.startsWith('lucide:')
  const name = v.replace(/^lucide:/, '').replace(/Icon$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return hero ? (HEROICONS[name] ?? name) : name
}

/** What Octarine seeds (viewdefaultweek000000000, typedefaultbug0000000000…) keeps the ids Tasks seeds. */
const SEEDED_VIEWS: Record<string, string> = { week: 'due-this-week', recent: 'recently-completed' }
function seededId(id: string): string | undefined {
  const m = /^(view|type|bucket)default([a-z]+?)0*$/.exec(id)
  if (!m) return undefined
  return m[1] === 'view' ? SEEDED_VIEWS[m[2]] : m[2]
}
const KEY = /^[A-Z][A-Z0-9]{1,4}$/
const keys = (v: unknown) => strs(v).map((k) => k.toUpperCase()).filter((k) => KEY.test(k))

function frontMatter(text: string): { fields: Record<string, unknown>; body: string } | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  try {
    const fields = parseYaml(m[1]) as unknown
    return fields && typeof fields === 'object' ? { fields: fields as Record<string, unknown>, body: m[2].trim() } : null
  } catch {
    return null
  }
}

type Kind = 'task' | 'project' | 'space' | 'cycle' | 'status' | 'label' | 'type' | 'bucket' | 'view' | 'template' | 'activity' | 'other'

function kindOf(path: string): { kind: Kind; archived: boolean; id: string } {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const archived = parts.includes('.archive')
  const dirs = parts.slice(0, -1).filter((p) => p !== '.archive')
  const file = parts[parts.length - 1] ?? ''
  const id = file.replace(/\.(md|json|jsonl|ya?ml)$/, '')
  const last = dirs[dirs.length - 1] ?? ''
  const map: Record<string, Kind> = { tasks: 'task', projects: 'project', spaces: 'space', cycles: 'cycle', statuses: 'status', labels: 'label', types: 'type', buckets: 'bucket', views: 'view', filters: 'view', templates: 'template', activity: 'activity', activities: 'activity' }
  return { kind: map[last] ?? 'other', archived, id }
}

export function importOctarine(files: SourceFile[], now: string): { workspace: Workspace; warnings: string[] } {
  const ws = emptyWorkspace()
  const warnings: string[] = []
  const ids = new Map<string, string>()
  const idFor = (octarineId: string) => {
    let id = ids.get(octarineId)
    if (!id) {
      const seeded = seededId(octarineId)
      id = seeded && ![...ids.values()].includes(seeded) ? seeded : newId()
      ids.set(octarineId, id)
    }
    return id
  }
  const parsed = files.map((f) => ({ ...kindOf(f.path), file: f, fm: f.path.endsWith('.md') ? frontMatter(f.text) : null }))
  const of = (k: Kind) => parsed.filter((p) => p.kind === k && p.fm)
  const order = (f: Record<string, unknown>) => (typeof f.order === 'number' ? f.order : Infinity)
  const createdAt = (f: Record<string, unknown>) => (f.created instanceof Date ? f.created.toISOString() : typeof f.created === 'string' ? f.created : '')
  /** Octarine's own order: the order field, then the creation time (its seeds and new items have no order). */
  const byOrder = (a: { fm: { fields: Record<string, unknown> } | null }, b: { fm: { fields: Record<string, unknown> } | null }) =>
    order(a.fm!.fields) - order(b.fm!.fields) || createdAt(a.fm!.fields).localeCompare(createdAt(b.fm!.fields))

  // config.yml: the key for tasks without a project (and its old keys), the highest number each project
  // has handed out (so no ID is ever reused), and the cycle schedule (0 = Monday, as in Tasks).
  let cfg: Record<string, unknown> = {}
  const config = files.find((f) => /(^|\/)config\.ya?ml$/.test(f.path))
  if (config) {
    try {
      const c = parseYaml(config.text) as unknown
      if (c && typeof c === 'object') cfg = c as Record<string, unknown>
    } catch {
      warnings.push('config.yml could not be read.')
    }
  }
  const unassigned = str(cfg.unassigned_key ?? cfg.unassignedKey)?.toUpperCase()
  if (unassigned && KEY.test(unassigned)) ws.settings.noProjectKey = unassigned
  const noProjectAliases = keys(cfg.unassigned_key_aliases).filter((k) => k !== ws.settings.noProjectKey)
  const handedOut = (cfg.project_numbers && typeof cfg.project_numbers === 'object' ? cfg.project_numbers : {}) as Record<string, unknown>
  const cycleConfig = cfg.cycles && typeof cfg.cycles === 'object' ? (cfg.cycles as Record<string, unknown>) : null
  if (cycleConfig) {
    const days = Number(cycleConfig.duration_days)
    if ([7, 14, 21, 28].includes(days)) ws.cycleSettings.weeks = days / 7
    const start = Number(cycleConfig.start_day)
    if (Number.isInteger(start) && start >= 0 && start <= 6) ws.cycleSettings.startDay = start
    // Octarine has no week setting of its own; a cycle start on Saturday, Sunday or Monday says where weeks begin.
    if ([5, 6, 0].includes(start)) ws.settings.weekStart = start
  }

  // Archived vocabulary comes over only if a task still uses it.
  const taskFields = parsed.filter((p) => p.kind === 'task' && p.fm).map((p) => p.fm!.fields)
  const used = (key: string) => new Set(taskFields.flatMap((f) => strs(f[key]).map((v) => normaliseLabel(v).toLowerCase())))
  const usedLabels = used('labels')
  const usedStates = used('state')
  const usedTypes = used('type')
  const usedBuckets = used('bucket')
  const keep = (p: (typeof parsed)[number], name: string | undefined, inUse: Set<string>) => !p.archived || inUse.has(p.id.toLowerCase()) || (!!name && inUse.has(normaliseLabel(name).toLowerCase()))

  // Vocabulary first: statuses, labels, types, buckets.
  for (const p of of('status').sort((a, b) => order(a.fm!.fields) - order(b.fm!.fields))) {
    const f = p.fm!.fields
    const name = str(f.name)
    const category = CATEGORIES.includes(f.category as StatusCategory) ? (f.category as StatusCategory) : 'unstarted'
    if (!name || BUILTIN_STATUSES.some((b) => b.id === p.id) || !keep(p, name, usedStates)) continue
    ws.statuses.push({ id: p.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'), name, category, color: colour(f.color), builtin: false })
  }
  for (const p of of('label').sort(byOrder)) {
    const name = normaliseLabel(str(p.fm!.fields.name) ?? '')
    if (name && keep(p, name, usedLabels) && !ws.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) ws.labels.push({ name, color: colour(p.fm!.fields.color) })
  }
  for (const p of of('type').sort((a, b) => order(a.fm!.fields) - order(b.fm!.fields))) {
    const f = p.fm!.fields
    if (str(f.name) && keep(p, str(f.name), usedTypes)) ws.types.push({ id: idFor(p.id), name: str(f.name)!, color: colour(f.color), labels: strs(f.labels).map(normaliseLabel), priority: prio(f.priority) })
  }
  for (const p of of('bucket').sort((a, b) => order(a.fm!.fields) - order(b.fm!.fields))) {
    const f = p.fm!.fields
    if (str(f.name) && keep(p, str(f.name), usedBuckets)) ws.buckets.push({ id: idFor(p.id), name: str(f.name)!, color: colour(f.color) })
  }
  const typeId = (v: unknown) => (str(v) ? (ws.types.find((t) => t.id === ids.get(str(v)!) || t.name.toLowerCase() === str(v)!.toLowerCase())?.id) : undefined)
  const bucketId = (v: unknown) => (str(v) ? (ws.buckets.find((b) => b.id === ids.get(str(v)!) || b.name.toLowerCase() === str(v)!.toLowerCase())?.id) : undefined)
  const statusId = (v: unknown) => {
    const s = str(v)?.toLowerCase()
    if (!s) return 'todo'
    return ws.statuses.find((x) => x.id === s || x.name.toLowerCase() === s)?.id ?? (warnings.push(`Unknown status “${s}”, read as Todo.`), 'todo')
  }

  for (const p of of('space').sort((a, b) => order(a.fm!.fields) - order(b.fm!.fields))) {
    const f = p.fm!.fields
    ws.spaces.push({ id: idFor(p.id), name: (str(f.name) ?? 'Space').replace(/[,"]/g, ''), icon: icon(f.icon), color: colour(f.color), labels: strs(f.tags), description: p.fm!.body, links: [], archived: p.archived })
  }

  const statuses: ProjectStatus[] = ['backlog', 'planned', 'in-progress', 'paused', 'completed', 'cancelled']
  const octarineIdOf = new Map<string, string>()
  const oldKeys = new Map<string | undefined, string[]>([[undefined, noProjectAliases]])
  for (const p of of('project').sort((a, b) => order(a.fm!.fields) - order(b.fm!.fields))) {
    const f = p.fm!.fields
    const name = str(f.name) ?? 'Untitled project'
    const key = str(f.key)?.toUpperCase()
    const status = statuses.includes(f.status as ProjectStatus) ? (f.status as ProjectStatus) : f.state === 'completed' ? 'completed' : 'in-progress'
    const links = Array.isArray(f.resources)
      ? f.resources.flatMap((r: unknown) => {
          const o = r as Record<string, unknown>
          return o?.kind === 'link' && str(o.target) ? [{ title: str(o.title) ?? str(o.target)!, url: str(o.target)! }] : []
        })
      : []
    const id = idFor(p.id)
    const projectKey = key && KEY.test(key) && !ws.projects.some((x) => x.key === key) ? key : deriveKey(name, ws.projects.map((x) => x.key))
    octarineIdOf.set(id, p.id)
    oldKeys.set(id, keys(f.key_aliases ?? f.keyAliases).filter((k) => k !== projectKey))
    ws.projects.push({
      id, name, key: projectKey, next: 1,
      icon: icon(f.icon), color: colour(f.color), status, priority: prio(f.priority), start: date(f.startDate), target: date(f.targetDate),
      labels: strs(f.tags).map(normaliseLabel), space: str(f.space) ? ids.get(str(f.space)!) : undefined,
      statuses: Array.isArray(f.statuses) ? strs(f.statuses).map((s) => s.toLowerCase()) : undefined,
      labelsOffered: Array.isArray(f.labels) ? strs(f.labels) : undefined,
      buckets: Array.isArray(f.buckets) ? strs(f.buckets).map((b) => ids.get(b) ?? b) : undefined,
      description: p.fm!.body, links, archived: p.archived, pinned: f.pinned === true, query: str(f.tasksQuery ?? f.issuesQuery),
    })
  }

  for (const p of of('cycle')) {
    const f = p.fm!.fields
    const number = Number(f.cycleNumber ?? f.number)
    if (!date(f.start) || !date(f.end) || !Number.isFinite(number)) continue
    const state = ['upcoming', 'active', 'ended'].includes(f.state as string) ? (f.state as 'upcoming' | 'active' | 'ended') : 'ended'
    ids.set(p.id, String(number))
    ws.cycles.push({ id: String(number), number, name: f.generated ? undefined : str(f.name), start: date(f.start)!, end: date(f.end)!, state, goal: str(f.goal), planned: [], stats: f.stats as never })
  }
  // Cycles stay on if Octarine has them on (or has cycles and no setting says otherwise).
  ws.cycleSettings.enabled = cycleConfig ? cycleConfig.enabled === true : ws.cycles.length > 0

  // History and comments, best effort: JSON ({events: [...]}, an array, or one event per line).
  const activity = new Map<string, HistoryEntry[]>()
  for (const p of parsed.filter((x) => x.kind === 'activity')) {
    let events: Record<string, unknown>[] = []
    try {
      const data = JSON.parse(p.file.text)
      events = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : []
    } catch {
      const lines = p.file.text.split('\n').filter((l) => l.trim().startsWith('{'))
      try {
        events = lines.map((l) => JSON.parse(l))
      } catch {
        warnings.push(`Couldn't read the history in ${p.file.path}.`)
      }
    }
    const list: HistoryEntry[] = []
    for (const e of events) {
      const at = stamp(e.at ?? e.time ?? e.created, now)
      const name = (id: unknown) => ws.statuses.find((s) => s.id === str(id))?.name ?? str(id) ?? ''
      if (e.type === 'comment' && str(e.body)) list.push({ at, kind: 'comment', text: str(e.body), edited: e.editedAt ? stamp(e.editedAt, at) : undefined })
      else if (e.type === 'created') list.push({ at, kind: 'created' })
      else if (e.type === 'state_changed') list.push({ at, kind: 'status', from: name(e.from), to: name(e.to) })
      else if (e.type === 'archived' || e.type === 'restored') list.push({ at, kind: e.type })
      else if (e.type === 'project_changed') list.push({ at, kind: 'project', from: ws.projects.find((x) => x.id === ids.get(str(e.from) ?? ''))?.name ?? '', to: ws.projects.find((x) => x.id === ids.get(str(e.to) ?? ''))?.name ?? '' })
    }
    activity.set(str(events[0]?.taskId) ?? p.id, list.sort((a, b) => a.at.localeCompare(b.at)))
  }

  const tasks = of('task')
  for (const p of tasks) {
    const f = p.fm!.fields
    const created = stamp(f.created, now)
    const project = str(f.project) ? ids.get(str(f.project)!) : undefined
    const history = activity.get(p.id) ?? []
    if (!history.some((h) => h.kind === 'created')) history.unshift({ at: created, kind: 'created' })
    const status = statusId(f.state)
    const category = ws.statuses.find((s) => s.id === status)?.category
    const task: Task = {
      id: idFor(p.id),
      number: Number(f.number) > 0 ? Number(f.number) : 0,
      project,
      space: !project && str(f.space) ? ids.get(str(f.space)!) : undefined,
      parent: undefined,
      title: str(f.title) ?? 'Untitled task',
      description: p.fm!.body,
      status,
      priority: prio(f.priority),
      labels: [...new Set(strs(f.labels).map(normaliseLabel).filter(Boolean))],
      due: date(f.due),
      type: typeId(f.type),
      bucket: bucketId(f.bucket),
      cycle: str(f.cycle) ? ids.get(str(f.cycle)!) : undefined,
      created,
      updated: stamp(f.updated, created),
      completed: category === 'completed' ? stamp(f.completed ?? f.updated, created) : undefined,
      cancelled: category === 'cancelled' ? stamp(f.cancelled ?? f.updated, created) : undefined,
      archived: p.archived ? stamp(f.updated, now) : undefined,
      order: typeof f.manualOrder === 'number' ? f.manualOrder : undefined,
      aliases: strs(f.aliases),
      fields: {},
      history,
    }
    ws.tasks.push(task)
  }
  // Parents after every task has an id; subtasks share their parent's project.
  for (const p of tasks) {
    const parent = str(p.fm!.fields.parent_id ?? p.fm!.fields.parent)
    if (!parent) continue
    const task = ws.tasks.find((t) => t.id === ids.get(p.id))!
    const parentId = ids.get(parent)
    const parentTask = ws.tasks.find((t) => t.id === parentId)
    if (parentTask) {
      task.parent = parentTask.id
      task.project = parentTask.project
    }
  }
  // Numbers: keep Octarine's; give missing ones the next free number.
  const next = (projectId?: string) => {
    const used = ws.tasks.filter((t) => t.project === projectId).map((t) => t.number)
    return Math.max(0, ...used) + 1
  }
  for (const t of ws.tasks) if (!t.number) t.number = next(t.project)
  for (const pr of ws.projects) pr.next = Math.max(next(pr.id), (Number(handedOut[octarineIdOf.get(pr.id) ?? '']) || 0) + 1)
  ws.settings.noProjectNext = Math.max(next(undefined), (Number(cfg.unassigned_number_highwater) || 0) + 1)
  // A key changed in Octarine left its old IDs working (SITE-4 for WEB-4); they keep working here.
  for (const t of ws.tasks) {
    const old = (oldKeys.get(t.project) ?? []).map((k) => `${k}-${t.number}`)
    t.aliases = [...new Set([...t.aliases, ...old])]
  }

  for (const v of of('view').sort(byOrder)) {
    const f = v.fm!.fields
    if (!str(f.name) || v.archived) continue
    const id = idFor(v.id)
    const query = typeof f.query === 'string' ? f.query : ''
    // Octarine's untouched "Due this week" (the next 7 days) becomes Tasks' own, which follows the week setting.
    const seededQuery = id === 'due-this-week' && query.trim() === 'is:open due:<7d' ? 'is:open due:this-week' : query
    ws.filters.push({ id, name: str(f.name)!, query: seededQuery, icon: icon(f.icon), color: colour(f.color), project: str(f.project) ? ids.get(str(f.project)!) : undefined, space: str(f.space) ? ids.get(str(f.space)!) : undefined })
  }
  const skipped = parsed.filter((p) => p.kind === 'template').length
  if (skipped) warnings.push(`${skipped} template(s) skipped (Tasks has no templates).`)
  const unreadable = parsed.filter((p) => p.file.path.endsWith('.md') && !p.fm && p.kind !== 'other').length
  if (unreadable) warnings.push(`${unreadable} file(s) had no readable front matter.`)
  return { workspace: ws, warnings }
}
