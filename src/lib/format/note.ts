/**
 * Format 1: the workspace as readable Markdown, the note's single source of truth.
 *
 *   ---                                   front matter: settings as one JSON object per line
 *   tasks: 1
 *   labels:
 *     - {"name":"Bug","color":"#CB7876"}
 *   ---
 *   # Career                              a space (# Projects / # No project are reserved)
 *   ## Website                            a project
 *   - Key: WEB                            properties, one per line, up to a blank line
 *   ### WEB-14 Fix the signup link        a task;  #### = a subtask of the task above
 *   - Status: In progress
 *
 *   Description in Markdown.              lines starting with # or > are escaped with \
 *
 *   > 2026-11-24T12:02Z · Comment: text   history and comments, oldest first
 *
 * The writer is deterministic (same workspace → same text) so a change is a small diff in
 * Standard Notes' revisions. The reader accepts hand edits: a task heading without an ID
 * gets one, unknown property lines stay in the description, text before the first heading
 * is kept as the preamble (escaped like a description).
 */
import { BUILTIN_STATUSES, CATEGORIES, emptyWorkspace, PRIORITY_NAMES, PROJECT_STATUSES } from '../model/defaults'
import type {
  Bucket,
  Cycle,
  CycleSettings,
  Field,
  Filter,
  HistoryEntry,
  HistoryKind,
  Label,
  Link,
  Priority,
  Project,
  ProjectStatus,
  Space,
  Status,
  StatusCategory,
  Task,
  TaskType,
  Workspace,
} from '../model/types'
import { newId, nextWeekStart, statusOf, today, WEEKDAYS } from '../model/workspace'

export const FORMAT_MARKER = 'tasks: 1'
const SPACES_OFF = 'Projects'
const NO_PROJECT = 'No project'

// ───────────────────────── writing ─────────────────────────

const json = (value: unknown) => JSON.stringify(value)

function clean<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  return out
}

function frontMatter(ws: Workspace): string[] {
  const lines = ['---', FORMAT_MARKER]
  lines.push(`no-project: ${json({ key: ws.settings.noProjectKey, next: ws.settings.noProjectNext })}`)
  if (!ws.settings.comments) lines.push('comments: false')
  if (ws.settings.weekStart) lines.push(`week-starts: ${WEEKDAYS[ws.settings.weekStart]}`)
  const list = (name: string, items: object[]) => {
    if (!items.length) return
    lines.push(`${name}:`)
    for (const item of items) lines.push(`  - ${json(item)}`)
  }
  // Built-in statuses are only written when recoloured; custom ones in full.
  list(
    'statuses',
    ws.statuses
      .filter((s) => !s.builtin || s.color)
      .map((s) => (s.builtin ? { id: s.id, color: s.color } : clean({ id: s.id, name: s.name, category: s.category, color: s.color }))),
  )
  list('labels', ws.labels.map((l) => clean({ name: l.name, color: l.color })))
  list('types', ws.types.map((t) => clean({ id: t.id, name: t.name, color: t.color, labels: t.labels, priority: t.priority || undefined })))
  list('buckets', ws.buckets.map((b) => clean({ id: b.id, name: b.name, color: b.color })))
  list(
    'fields',
    ws.fields.map((f) => clean({ id: f.id, name: f.name, type: f.type, options: f.options.map((o) => clean({ value: o.value, color: o.color })) })),
  )
  list('filters', ws.filters.map((f) => clean({ id: f.id, name: f.name, query: f.query, icon: f.icon, color: f.color, project: f.project, space: f.space })))
  const cyclesChanged = ws.cycleSettings.weeks !== 2 || ws.cycleSettings.startDay !== 0
  if (ws.cycleSettings.enabled || ws.cycles.length || cyclesChanged) lines.push(`cycles: ${json(ws.cycleSettings)}`)
  list(
    'cycle-list',
    ws.cycles.map((c) => clean({ id: c.id, number: c.number, name: c.name, start: c.start, end: c.end, state: c.state, goal: c.goal, planned: c.planned, stats: c.stats })),
  )
  lines.push('---')
  return lines
}

/** Escapes description lines that would read as structure (# headings, > history). Lossless. */
export function escapeBody(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*\\*[#>]/.test(line) ? line.replace(/^(\s*)/, '$1\\') : line))
    .join('\n')
}

export function unescapeBody(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*\\+[#>]/.test(line) ? line.replace(/^(\s*)\\/, '$1') : line))
    .join('\n')
}

/** Values that hold a newline or start with a quote are written as JSON strings. */
function encodeValue(value: string): string {
  return /\n/.test(value) || value.startsWith('"') ? json(value) : value
}

function decodeValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'string') return parsed
    } catch {
      /* not JSON: keep as written */
    }
  }
  return value
}

const linkLine = (l: Link) => `- Link: [${l.title.replace(/[[\]]/g, '')}](${l.url})`

/**
 * Closes a code fence a text leaves open. The reader ignores headings inside fences, so an open fence
 * would swallow every task after it; Markdown runs an unclosed fence to the end anyway, so closing it
 * at the end shows the same.
 */
export function closeFences(text: string): string {
  let open: string | null = null
  for (const line of text.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line)
    if (m) open = open ? null : m[1]
  }
  return open ? `${text}\n${open}` : text
}

function body(text: string): string[] {
  const t = text.trim()
  return t ? ['', escapeBody(closeFences(t))] : []
}

function historyLines(task: Task): string[] {
  const out: string[] = []
  for (const h of task.history) {
    const head = `> ${h.at} · `
    switch (h.kind) {
      case 'created':
        out.push(head + 'Created')
        break
      case 'archived':
        out.push(head + 'Archived')
        break
      case 'restored':
        out.push(head + 'Restored')
        break
      case 'comment': {
        const [first, ...rest] = (h.text ?? '').split('\n')
        out.push(head + `Comment${h.edited ? ` (edited ${h.edited})` : ''}: ${first}`)
        for (const line of rest) out.push(`>   ${line}`)
        break
      }
      default: {
        const name = HISTORY_NAMES[h.kind]
        out.push(head + `${name}: ${h.from || 'none'} → ${h.to || 'none'}`)
      }
    }
  }
  return out.length ? ['', ...out] : []
}

const HISTORY_NAMES: Record<HistoryKind, string> = {
  created: 'Created',
  comment: 'Comment',
  status: 'Status',
  priority: 'Priority',
  due: 'Due',
  project: 'Project',
  labels: 'Labels',
  type: 'Type',
  bucket: 'Bucket',
  cycle: 'Cycle',
  parent: 'Parent',
  title: 'Title',
  archived: 'Archived',
  restored: 'Restored',
}

function taskLines(ws: Workspace, task: Task, key: string, depth: 3 | 4): string[] {
  const p: string[] = []
  p.push(`- Status: ${statusOf(ws, task.status).name}`)
  if (task.priority) p.push(`- Priority: ${PRIORITY_NAMES[task.priority]}`)
  if (task.labels.length) p.push(`- Labels: ${task.labels.join(', ')}`)
  if (task.due) p.push(`- Due: ${task.due}`)
  const type = task.type && ws.types.find((t) => t.id === task.type)
  if (type) p.push(`- Type: ${type.name}`)
  const bucket = task.bucket && ws.buckets.find((b) => b.id === task.bucket)
  if (bucket) p.push(`- Bucket: ${bucket.name}`)
  if (task.cycle) p.push(`- Cycle: ${task.cycle}`)
  for (const field of ws.fields) {
    const v = task.fields[field.id]
    if (v) p.push(`- ${field.name}: ${encodeValue(v)}`)
  }
  p.push(`- Created: ${task.created}`)
  if (task.updated !== task.created) p.push(`- Updated: ${task.updated}`)
  if (task.completed) p.push(`- Completed: ${task.completed}`)
  if (task.cancelled) p.push(`- Cancelled: ${task.cancelled}`)
  if (task.archived) p.push(`- Archived: ${task.archived}`)
  if (task.order !== undefined) p.push(`- Order: ${task.order}`)
  if (task.aliases.length) p.push(`- Aliases: ${task.aliases.join(', ')}`)
  p.push(`- Ref: ${task.id}`)
  const title = task.title.replace(/\n/g, ' ').trim() || 'Untitled task'
  return [`${'#'.repeat(depth)} ${key}-${task.number} ${title}`, ...p, ...body(task.description), ...historyLines(task), '']
}

function tasksBlock(ws: Workspace, tasks: Task[], key: string): string[] {
  const out: string[] = []
  const ids = new Set(tasks.map((t) => t.id))
  const top = tasks.filter((t) => !t.parent || !ids.has(t.parent)).sort((a, b) => a.number - b.number)
  for (const task of top) {
    out.push(...taskLines(ws, task, key, 3))
    for (const kid of tasks.filter((t) => t.parent === task.id).sort((a, b) => a.number - b.number)) out.push(...taskLines(ws, kid, key, 4))
  }
  return out
}

function projectLines(ws: Workspace, project: Project): string[] {
  const p = [`## ${project.name}`, `- Key: ${project.key}`, `- Next: ${project.next}`]
  p.push(`- Status: ${PROJECT_STATUSES.find((s) => s.id === project.status)?.name ?? 'Planned'}`)
  if (project.priority) p.push(`- Priority: ${PRIORITY_NAMES[project.priority]}`)
  if (project.start) p.push(`- Start: ${project.start}`)
  if (project.target) p.push(`- Target: ${project.target}`)
  if (project.icon) p.push(`- Icon: ${project.icon}`)
  if (project.color) p.push(`- Color: ${project.color}`)
  if (project.labels.length) p.push(`- Labels: ${project.labels.join(', ')}`)
  if (project.statuses) p.push(`- Statuses: ${project.statuses.join(', ')}`)
  if (project.labelsOffered) p.push(`- Labels offered: ${project.labelsOffered.join(', ')}`)
  if (project.buckets) p.push(`- Buckets: ${project.buckets.join(', ')}`)
  if (project.query) p.push(`- Query: ${encodeValue(project.query)}`)
  if (project.pinned) p.push('- Pinned: yes')
  if (project.archived) p.push('- Archived: yes')
  for (const l of project.links) p.push(linkLine(l))
  p.push(`- Ref: ${project.id}`)
  const tasks = ws.tasks.filter((t) => t.project === project.id)
  return [...p, ...body(project.description), '', ...tasksBlock(ws, tasks, project.key)]
}

function spaceLines(ws: Workspace, space: Space): string[] {
  const p = [`# ${space.name}`]
  if (space.icon) p.push(`- Icon: ${space.icon}`)
  if (space.color) p.push(`- Color: ${space.color}`)
  if (space.labels.length) p.push(`- Labels: ${space.labels.join(', ')}`)
  if (space.archived) p.push('- Archived: yes')
  for (const l of space.links) p.push(linkLine(l))
  p.push(`- Ref: ${space.id}`)
  const own = ws.tasks.filter((t) => !t.project && t.space === space.id)
  const out = [...p, ...body(space.description), '', ...tasksBlock(ws, own, ws.settings.noProjectKey)]
  for (const project of ws.projects.filter((pr) => pr.space === space.id)) out.push(...projectLines(ws, project))
  return out
}

/** The note's text for a workspace. */
export function writeNote(ws: Workspace): string {
  const out = frontMatter(ws)
  if (ws.preamble.trim()) out.push('', escapeBody(closeFences(ws.preamble.trim())))
  out.push('')
  const spaceIds = new Set(ws.spaces.map((s) => s.id))
  for (const space of ws.spaces) out.push(...spaceLines(ws, space))
  const loose = ws.projects.filter((p) => !p.space || !spaceIds.has(p.space))
  if (loose.length) {
    if (ws.spaces.length) out.push(`# ${SPACES_OFF}`, '')
    for (const project of loose) out.push(...projectLines(ws, project))
  }
  const projectIds = new Set(ws.projects.map((p) => p.id))
  // Tasks outside any (existing) project and not kept in an (existing) space.
  const noProject = ws.tasks.filter((t) => {
    if (t.project && projectIds.has(t.project)) return false
    return !(!t.project && t.space && spaceIds.has(t.space))
  })
  if (noProject.length) out.push(`# ${NO_PROJECT}`, '', ...tasksBlock(ws, noProject, ws.settings.noProjectKey))
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// ───────────────────────── reading ─────────────────────────

export type NoteKind = 'tasks' | 'empty' | 'other'

export interface ReadResult {
  kind: NoteKind
  workspace: Workspace
  warnings: string[]
}

export function isTasksNote(text: string): boolean {
  return /^\uFEFF?---\r?\ntasks: 1\r?\n/.test(text)
}

function parseFrontMatter(lines: string[], ws: Workspace, warnings: string[]) {
  let list = ''
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line || line === FORMAT_MARKER) continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && list) {
      try {
        addListItem(ws, list, JSON.parse(item[1]))
      } catch {
        warnings.push(`Couldn't read a ${list} entry: ${item[1].slice(0, 60)}`)
      }
      continue
    }
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, key, value] = kv
    list = value ? '' : key
    try {
      if (key === 'no-project' && value) {
        const v = JSON.parse(value)
        if (typeof v.key === 'string') ws.settings.noProjectKey = v.key
        if (typeof v.next === 'number') ws.settings.noProjectNext = v.next
      } else if (key === 'comments') ws.settings.comments = value !== 'false'
      else if (key === 'week-starts') {
        const day = WEEKDAYS.findIndex((d) => d.toLowerCase() === value.trim().toLowerCase())
        if (day >= 0) ws.settings.weekStart = day
        else warnings.push(`Unknown first day of the week “${value}”, read as Monday.`)
      }
      else if (key === 'cycles' && value) {
        const v = JSON.parse(value) as Partial<CycleSettings>
        ws.cycleSettings = { enabled: !!v.enabled, weeks: clampInt(v.weeks, 1, 4, 2), startDay: clampInt(v.startDay, 0, 6, 0) }
      }
    } catch {
      warnings.push(`Couldn't read the ${key} setting.`)
    }
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const prio = (v: unknown): Priority => (typeof v === 'number' && [0, 1, 2, 3, 4].includes(v) ? (v as Priority) : 0)

function addListItem(ws: Workspace, list: string, v: Record<string, unknown>) {
  switch (list) {
    case 'statuses': {
      const id = str(v.id)
      if (!id) return
      const builtin = ws.statuses.find((s) => s.builtin && s.id === id)
      if (builtin) {
        builtin.color = str(v.color)
        return
      }
      const category = CATEGORIES.includes(v.category as StatusCategory) ? (v.category as StatusCategory) : 'unstarted'
      ws.statuses.push({ id, name: str(v.name) ?? id, category, color: str(v.color), builtin: false })
      return
    }
    case 'labels':
      if (str(v.name)) ws.labels.push({ name: str(v.name)!, color: str(v.color) } as Label)
      return
    case 'types':
      if (str(v.id) && str(v.name)) ws.types.push({ id: str(v.id)!, name: str(v.name)!, color: str(v.color), labels: strs(v.labels), priority: prio(v.priority) } as TaskType)
      return
    case 'buckets':
      if (str(v.id) && str(v.name)) ws.buckets.push({ id: str(v.id)!, name: str(v.name)!, color: str(v.color) } as Bucket)
      return
    case 'fields': {
      const types = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'url', 'media', 'checkbox']
      if (!str(v.id) || !str(v.name)) return
      const options = Array.isArray(v.options)
        ? v.options.flatMap((o: unknown) => {
            const r = o as Record<string, unknown>
            return str(r?.value) ? [{ value: str(r.value)!, color: str(r.color) }] : []
          })
        : []
      ws.fields.push({ id: str(v.id)!, name: str(v.name)!, type: (types.includes(v.type as string) ? v.type : 'text') as Field['type'], options })
      return
    }
    case 'filters':
      if (str(v.id) && str(v.name))
        ws.filters.push({ id: str(v.id)!, name: str(v.name)!, query: typeof v.query === 'string' ? v.query : '', icon: str(v.icon), color: str(v.color), project: str(v.project), space: str(v.space) } as Filter)
      return
    case 'cycle-list': {
      const number = typeof v.number === 'number' ? v.number : NaN
      if (!str(v.id) || !Number.isFinite(number) || !str(v.start) || !str(v.end)) return
      const state = ['upcoming', 'active', 'ended'].includes(v.state as string) ? (v.state as Cycle['state']) : 'upcoming'
      ws.cycles.push({ id: str(v.id)!, number, name: str(v.name), start: str(v.start)!, end: str(v.end)!, state, goal: str(v.goal), planned: strs(v.planned), stats: v.stats as Cycle['stats'] })
    }
  }
}

interface Section {
  level: number
  heading: string
  lines: string[]
}

const TASK_HEADING = /^(?:([A-Z][A-Z0-9]{1,4})-(\d+) )?(.*)$/
const PROPERTY = /^- ([A-Za-z][A-Za-z ]*?): (.*)$/
const HISTORY = /^> (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) · (.*)$/

/** Splits a section's lines into properties, description and history. */
function splitSection(lines: string[], knownKeys: (key: string) => boolean) {
  const props = new Map<string, string[]>()
  let i = 0
  for (; i < lines.length; i++) {
    const m = PROPERTY.exec(lines[i])
    if (!m || !knownKeys(m[1])) break
    const values = props.get(m[1]) ?? []
    values.push(m[2])
    props.set(m[1], values)
  }
  const rest = lines.slice(i)
  // History is the run of "> " lines at the end; descriptions escape their own > lines.
  let end = rest.length
  while (end > 0 && rest[end - 1].trim() === '') end--
  let start = end
  while (start > 0 && rest[start - 1].startsWith('>')) start--
  let first = start
  while (first < end && !HISTORY.test(rest[first])) first++
  const history = first < end ? rest.slice(first, end) : []
  const description = unescapeBody(rest.slice(0, first < end ? first : rest.length).join('\n').trim())
  return { props, description, history }
}

function parseHistory(lines: string[]): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const line of lines) {
    const m = HISTORY.exec(line)
    if (m) {
      const [, at, rest] = m
      const c = /^Comment(?: \(edited (\S+)\))?: ?(.*)$/.exec(rest)
      if (c) {
        out.push({ at, kind: 'comment', text: c[2], edited: c[1] })
        continue
      }
      if (rest === 'Created' || rest.startsWith('Created ')) out.push({ at, kind: 'created' })
      else if (rest === 'Archived') out.push({ at, kind: 'archived' })
      else if (rest === 'Restored') out.push({ at, kind: 'restored' })
      else {
        const ch = /^([A-Za-z]+): (.*) → (.*)$/.exec(rest)
        const kind = ch && (Object.entries(HISTORY_NAMES).find(([, n]) => n === ch[1])?.[0] as HistoryKind | undefined)
        if (ch && kind) out.push({ at, kind, from: ch[2] === 'none' ? '' : ch[2], to: ch[3] === 'none' ? '' : ch[3] })
      }
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'comment' && (line.startsWith('>   ') || line === '>')) last.text = `${last.text ?? ''}\n${line.slice(4)}`
  }
  return out
}

const one = (props: Map<string, string[]>, key: string) => props.get(key)?.[0]
const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const yes = (v?: string) => v === 'yes' || v === 'true'
const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
const stamp = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(v) ? v : undefined)

function priorityByName(v?: string): Priority {
  if (!v) return 0
  const hit = Object.entries(PRIORITY_NAMES).find(([, n]) => n.toLowerCase() === v.toLowerCase())
  return hit ? (Number(hit[0]) as Priority) : 0
}

function parseLinks(values: string[] = []): Link[] {
  return values.flatMap((v) => {
    const m = /^\[(.*)\]\((.*)\)$/.exec(v.trim())
    return m ? [{ title: m[1], url: m[2] }] : []
  })
}

const PROJECT_KEYS = new Set(['Key', 'Next', 'Status', 'Priority', 'Start', 'Target', 'Icon', 'Color', 'Labels', 'Statuses', 'Labels offered', 'Buckets', 'Query', 'Pinned', 'Archived', 'Link', 'Ref'])
const SPACE_KEYS = new Set(['Icon', 'Color', 'Labels', 'Archived', 'Link', 'Ref'])
const TASK_KEYS = new Set(['Status', 'Priority', 'Labels', 'Due', 'Type', 'Bucket', 'Cycle', 'Created', 'Updated', 'Completed', 'Cancelled', 'Archived', 'Order', 'Aliases', 'Ref'])

/** Reads a note. Anything that isn't a Tasks note comes back as kind 'other' (or 'empty'). */
export function readNote(text: string): ReadResult {
  const warnings: string[] = []
  const ws = emptyWorkspace()
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!normalised.trim()) return { kind: 'empty', workspace: ws, warnings }
  if (!isTasksNote(normalised)) return { kind: 'other', workspace: ws, warnings }

  const lines = normalised.split('\n')
  const close = lines.indexOf('---', 1)
  if (close < 0) return { kind: 'other', workspace: ws, warnings: ['The settings block at the top is not closed with ---.'] }
  parseFrontMatter(lines.slice(1, close), ws, warnings)

  // Sections by heading level; the preamble is everything before the first heading.
  const sections: Section[] = []
  const preamble: string[] = []
  let inFence = false
  for (const line of lines.slice(close + 1)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const h = !inFence && /^(#{1,4}) (.*)$/.exec(line)
    if (h) sections.push({ level: h[1].length, heading: h[2].trim(), lines: [] })
    else if (sections.length) sections[sections.length - 1].lines.push(line)
    else preamble.push(line)
  }
  ws.preamble = unescapeBody(preamble.join('\n').trim())

  const fieldByName = new Map(ws.fields.map((f) => [f.name.toLowerCase(), f]))
  const taskKey = (k: string) => TASK_KEYS.has(k) || fieldByName.has(k.toLowerCase())
  const statusByName = new Map(ws.statuses.map((s) => [s.name.toLowerCase(), s.id]))
  const usedIds = new Set<string>()
  const uniqueId = (id?: string) => {
    let out = id && /^[a-z0-9]{3,16}$/.test(id) && !usedIds.has(id) ? id : newId()
    while (usedIds.has(out)) out = newId()
    usedIds.add(out)
    return out
  }

  let space: Space | undefined
  let inNoProject = false
  let project: Project | undefined
  let parentTask: Task | undefined
  const pending: { task: Task; key?: string }[] = []

  for (const section of sections) {
    if (section.level === 1) {
      project = undefined
      parentTask = undefined
      inNoProject = section.heading === NO_PROJECT
      space = undefined
      if (section.heading === SPACES_OFF || inNoProject) continue
      const { props, description } = splitSection(section.lines, (k) => SPACE_KEYS.has(k))
      space = {
        id: uniqueId(one(props, 'Ref')),
        name: section.heading,
        icon: one(props, 'Icon'),
        color: one(props, 'Color'),
        labels: list(one(props, 'Labels')),
        description,
        links: parseLinks(props.get('Link')),
        archived: yes(one(props, 'Archived')),
      }
      ws.spaces.push(space)
    } else if (section.level === 2) {
      parentTask = undefined
      const { props, description } = splitSection(section.lines, (k) => PROJECT_KEYS.has(k))
      const statusName = one(props, 'Status')?.toLowerCase()
      const status = (PROJECT_STATUSES.find((s) => s.name.toLowerCase() === statusName)?.id ?? 'planned') as ProjectStatus
      const key = (one(props, 'Key') ?? '').toUpperCase()
      project = {
        id: uniqueId(one(props, 'Ref')),
        name: section.heading,
        key: /^[A-Z][A-Z0-9]{1,4}$/.test(key) ? key : 'PRJ',
        next: Math.max(1, Number(one(props, 'Next')) || 1),
        icon: one(props, 'Icon'),
        color: one(props, 'Color'),
        status,
        priority: priorityByName(one(props, 'Priority')),
        start: date(one(props, 'Start')),
        target: date(one(props, 'Target')),
        labels: list(one(props, 'Labels')),
        space: inNoProject ? undefined : space?.id,
        statuses: props.has('Statuses') ? list(one(props, 'Statuses')) : undefined,
        labelsOffered: props.has('Labels offered') ? list(one(props, 'Labels offered')) : undefined,
        buckets: props.has('Buckets') ? list(one(props, 'Buckets')) : undefined,
        description,
        links: parseLinks(props.get('Link')),
        archived: yes(one(props, 'Archived')),
        pinned: yes(one(props, 'Pinned')),
        query: one(props, 'Query') !== undefined ? decodeValue(one(props, 'Query')!) : undefined,
      }
      ws.projects.push(project)
    } else {
      const h = TASK_HEADING.exec(section.heading)!
      const { props, description, history } = splitSection(section.lines, taskKey)
      const created = stamp(one(props, 'Created')) ?? history.map((l) => HISTORY.exec(l)?.[1]).find(Boolean) ?? '1970-01-01T00:00Z'
      const statusName = one(props, 'Status')
      const status = statusName ? statusByName.get(statusName.toLowerCase()) : 'todo'
      if (statusName && !status) warnings.push(`Unknown status “${statusName}” on ${h[1] ?? ''}-${h[2] ?? '?'}; shown as Todo.`)
      const fields: Record<string, string> = {}
      for (const [k, values] of props) {
        const field = fieldByName.get(k.toLowerCase())
        if (field && !TASK_KEYS.has(k)) fields[field.id] = decodeValue(values[0])
      }
      const typeName = one(props, 'Type')?.toLowerCase()
      const bucketName = one(props, 'Bucket')?.toLowerCase()
      const task: Task = {
        id: uniqueId(one(props, 'Ref')),
        number: h[2] ? Number(h[2]) : 0,
        project: inNoProject ? undefined : project?.id,
        space: !project && !inNoProject ? space?.id : undefined,
        parent: section.level === 4 ? parentTask?.id : undefined,
        title: h[3].trim() || 'Untitled task',
        description,
        status: status ?? 'todo',
        priority: priorityByName(one(props, 'Priority')),
        labels: list(one(props, 'Labels')),
        due: date(one(props, 'Due')),
        type: typeName ? ws.types.find((t) => t.name.toLowerCase() === typeName)?.id : undefined,
        bucket: bucketName ? ws.buckets.find((b) => b.name.toLowerCase() === bucketName)?.id : undefined,
        cycle: one(props, 'Cycle'),
        created,
        updated: stamp(one(props, 'Updated')) ?? created,
        completed: stamp(one(props, 'Completed')),
        cancelled: stamp(one(props, 'Cancelled')),
        archived: stamp(one(props, 'Archived')),
        order: one(props, 'Order') !== undefined && Number.isFinite(Number(one(props, 'Order'))) ? Number(one(props, 'Order')) : undefined,
        aliases: list(one(props, 'Aliases')),
        fields,
        history: parseHistory(history),
      }
      // A subtask lives in its parent's project.
      if (section.level === 4 && parentTask) {
        task.project = parentTask.project
        task.space = parentTask.space
      }
      if (section.level === 3) parentTask = task
      ws.tasks.push(task)
      pending.push({ task, key: h[1] })
    }
  }

  // Numbers: keep what the text says, give hand-written tasks (no ID) the next free number.
  for (const { task } of pending) {
    if (task.number > 0) {
      const p = ws.projects.find((pr) => pr.id === task.project)
      if (p) p.next = Math.max(p.next, task.number + 1)
      else ws.settings.noProjectNext = Math.max(ws.settings.noProjectNext, task.number + 1)
    }
  }
  for (const { task } of pending) {
    if (task.number > 0) continue
    const p = ws.projects.find((pr) => pr.id === task.project)
    if (p) task.number = p.next++
    else task.number = ws.settings.noProjectNext++
  }
  return { kind: 'tasks', workspace: ws, warnings }
}

/** The line Standard Notes shows under the note's title in the notes list. */
export function previewLine(ws: Workspace, todayIso: string): string {
  const open = ws.tasks.filter((t) => !t.archived && !['completed', 'cancelled'].includes(statusOf(ws, t.status).category))
  // Due by the end of this week (local dates: toISOString would shift a day east of UTC).
  const weekIso = today(nextWeekStart(new Date(`${todayIso}T00:00:00`), ws.settings.weekStart))
  const dueSoon = open.filter((t) => t.due && t.due < weekIso).length
  const parts = [`${open.length} open`]
  if (dueSoon) parts.push(`${dueSoon} due this week`)
  return parts.join(' · ')
}

/** Status names that ship with every workspace, for readers that need them before a workspace exists. */
export const BUILTIN_STATUS_NAMES: Status[] = BUILTIN_STATUSES
