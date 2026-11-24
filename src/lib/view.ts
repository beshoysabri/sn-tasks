/**
 * Turns a location (a project's Tasks tab, a filter, No project…), a search and display options into
 * what the list shows: groups in Octarine's order, open tasks first, closed ones folded behind
 * "N closed", subtasks right under their parent (with the parent shown dimmed for context when it sits
 * in another group).
 */
import { PRIORITY_NAMES, PRIORITY_ORDER } from './model/defaults'
import type { Priority, Status, Task, Workspace } from './model/types'
import { isClosed, orderedStatuses, projectOf, projectStatuses, spaceIdOf, statusOf } from './model/workspace'
import { compareTasks, dueBucket, fieldKeys, matchContext, matches, parseQuery, type DueBucket } from './query'
import type { DisplayOptions, GroupBy, Location } from './store'
import type { NewTask } from './ops'

export interface Group {
  key: string
  name: string
  kind: GroupBy
  /** What the group's icon shows. */
  icon: { status?: Status; priority?: Priority; due?: DueBucket; color?: string; projectId?: string }
  tasks: Task[]
  /** Defaults for a task created with the group's +, or null when the group has no +. */
  defaults: Partial<NewTask> | null
}

export type Row =
  | { kind: 'header'; group: Group; count: number; collapsed: boolean }
  | { kind: 'task'; task: Task; depth: 0 | 1; branch?: 'middle' | 'last'; group: string }
  | { kind: 'context'; task: Task; group: string }
  | { kind: 'closed'; group: string; count: number; open: boolean }

/** The tasks a location covers, before the search. */
export function scopeTasks(ws: Workspace, loc: Location | undefined): Task[] {
  if (!loc) return ws.tasks
  switch (loc.kind) {
    case 'project':
      return ws.tasks.filter((t) => t.project === loc.id)
    case 'space':
      return ws.tasks.filter((t) => spaceIdOf(ws, t) === loc.id && !projectOf(ws, t)?.archived)
    case 'cycle':
      return ws.tasks.filter((t) => t.cycle === loc.id)
    case 'no-project':
      return ws.tasks.filter((t) => !t.project || !ws.projects.some((p) => p.id === t.project))
    case 'filter':
      return ws.tasks.filter((t) => !projectOf(ws, t)?.archived)
    default:
      return ws.tasks
  }
}

export interface ListInput {
  ws: Workspace
  tasks: Task[]
  search: string
  display: DisplayOptions
  collapsed: string[]
  openClosed: Set<string>
  now: number
  /** The project the list belongs to (for its statuses and the + defaults). */
  projectId?: string
}

export function searchTasks(ws: Workspace, tasks: Task[], search: string, now: number): Task[] {
  const query = parseQuery(search, fieldKeys(ws))
  const ctx = matchContext(ws, now)
  return tasks.filter((t) => matches(ctx, t, query))
}

const DUE_GROUPS: { key: DueBucket; name: string }[] = [
  { key: 'overdue', name: 'Overdue' },
  { key: 'past', name: 'Past' },
  { key: 'today', name: 'Today' },
  { key: 'week', name: 'This week' },
  { key: 'later', name: 'Later' },
  { key: 'none', name: 'No due date' },
]

export function groupTasks(ws: Workspace, tasks: Task[], groupBy: GroupBy, now: number, projectId?: string): Group[] {
  const project = projectId ? ws.projects.find((p) => p.id === projectId) : undefined
  const base = project ? { project: project.id } : {}
  switch (groupBy) {
    case 'status': {
      const offered = projectStatuses(ws, project).map((s) => s.id)
      const used = new Set(tasks.map((t) => statusOf(ws, t.status).id))
      return orderedStatuses(ws)
        .filter((s) => offered.includes(s.id) || used.has(s.id))
        .map((s) => ({ key: `status:${s.id}`, name: s.name, kind: groupBy, icon: { status: s }, tasks: tasks.filter((t) => statusOf(ws, t.status).id === s.id), defaults: { ...base, status: s.id } }))
    }
    case 'priority':
      return PRIORITY_ORDER.map((p) => ({ key: `priority:${p}`, name: PRIORITY_NAMES[p], kind: groupBy, icon: { priority: p }, tasks: tasks.filter((t) => t.priority === p), defaults: { ...base, priority: p } }))
    case 'type':
      return [
        ...ws.types.map((ty) => ({ key: `type:${ty.id}`, name: ty.name, kind: groupBy, icon: { color: ty.color }, tasks: tasks.filter((t) => t.type === ty.id), defaults: { ...base, type: ty.id } })),
        { key: 'type:none', name: 'No type', kind: groupBy, icon: {}, tasks: tasks.filter((t) => !ws.types.some((ty) => ty.id === t.type)), defaults: { ...base } },
      ]
    case 'bucket':
      return [
        ...ws.buckets.map((b) => ({ key: `bucket:${b.id}`, name: b.name, kind: groupBy, icon: { color: b.color }, tasks: tasks.filter((t) => t.bucket === b.id), defaults: { ...base, bucket: b.id } })),
        { key: 'bucket:none', name: 'No bucket', kind: groupBy, icon: {}, tasks: tasks.filter((t) => !ws.buckets.some((b) => b.id === t.bucket)), defaults: { ...base } },
      ]
    case 'due':
      return DUE_GROUPS.map((g) => ({
        key: `due:${g.key}`, name: g.name, kind: groupBy, icon: { due: g.key }, tasks: tasks.filter((t) => dueBucket(ws, t, now) === g.key),
        defaults: g.key === 'today' ? { ...base, due: localToday(now) } : g.key === 'none' ? { ...base } : null,
      }))
    case 'project':
      return [
        ...ws.projects.filter((p) => !p.archived).map((p) => ({ key: `project:${p.id}`, name: p.name, kind: groupBy, icon: { projectId: p.id, color: p.color }, tasks: tasks.filter((t) => t.project === p.id), defaults: { project: p.id } })),
        { key: 'project:none', name: 'No project', kind: groupBy, icon: {}, tasks: tasks.filter((t) => !t.project), defaults: {} },
      ]
    default:
      return [{ key: 'all', name: 'All tasks', kind: 'none', icon: {}, tasks, defaults: { ...base } }]
  }
}

function localToday(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The rows of the list. */
export function listRows(input: ListInput): { rows: Row[]; visible: Task[]; groups: Group[] } {
  const { ws, display, collapsed, openClosed, now } = input
  const found = searchTasks(ws, input.tasks, input.search, now)
  const groups = groupTasks(ws, found, display.groupBy, now, input.projectId).filter((g) => g.tasks.length)
  const compare = compareTasks(ws, display.ordering, display.direction)
  const rows: Row[] = []
  const visible: Task[] = []
  const grouped = display.groupBy !== 'none'
  for (const g of groups) {
    const isCollapsed = collapsed.includes(g.key)
    if (grouped) rows.push({ kind: 'header', group: g, count: g.tasks.length, collapsed: isCollapsed })
    if (isCollapsed) continue
    const inGroup = new Set(g.tasks.map((t) => t.id))
    const open = g.tasks.filter((t) => !isClosed(ws, t)).sort(compare)
    const closed = g.tasks.filter((t) => isClosed(ws, t)).sort(compare)
    const nest = (list: Task[]) => {
      // Parents first, each followed by its subtasks from the same list.
      const out: { task: Task; depth: 0 | 1; branch?: 'middle' | 'last'; contextFor?: Task }[] = []
      const placed = new Set<string>()
      for (const t of list) {
        if (placed.has(t.id)) continue
        if (t.parent && inGroup.has(t.parent) && list.some((x) => x.id === t.parent)) continue
        if (t.parent) {
          // Parent elsewhere: show it dimmed above its subtasks here.
          const parent = ws.tasks.find((x) => x.id === t.parent)
          const kids = list.filter((x) => x.parent === t.parent && !placed.has(x.id))
          if (parent) out.push({ task: parent, depth: 0, contextFor: parent })
          kids.forEach((k, i) => {
            placed.add(k.id)
            out.push({ task: k, depth: 1, branch: i === kids.length - 1 ? 'last' : 'middle' })
          })
          continue
        }
        placed.add(t.id)
        out.push({ task: t, depth: 0 })
        const kids = list.filter((x) => x.parent === t.id)
        kids.forEach((k, i) => {
          placed.add(k.id)
          out.push({ task: k, depth: 1, branch: i === kids.length - 1 ? 'last' : 'middle' })
        })
      }
      return out
    }
    const push = (items: ReturnType<typeof nest>) => {
      for (const item of items) {
        if (item.contextFor) rows.push({ kind: 'context', task: item.task, group: g.key })
        else {
          rows.push({ kind: 'task', task: item.task, depth: item.depth, branch: item.branch, group: g.key })
          visible.push(item.task)
        }
      }
    }
    push(nest(open))
    if (closed.length) {
      // A group of only closed tasks (Done) shows them; otherwise they fold behind "N closed".
      if (!open.length) push(nest(closed))
      else {
        const isOpen = openClosed.has(g.key)
        rows.push({ kind: 'closed', group: g.key, count: closed.length, open: isOpen })
        if (isOpen) push(nest(closed))
      }
    }
  }
  return { rows, visible, groups }
}

/** Board columns: statuses (or buckets) of the project, empty ones included. */
export function boardColumns(ws: Workspace, tasks: Task[], columns: 'status' | 'bucket', projectId?: string): Group[] {
  const project = projectId ? ws.projects.find((p) => p.id === projectId) : undefined
  if (columns === 'bucket') {
    const offered = project?.buckets ? ws.buckets.filter((b) => project.buckets!.includes(b.id)) : ws.buckets
    return [
      ...offered.map((b) => ({ key: `bucket:${b.id}`, name: b.name, kind: 'bucket' as GroupBy, icon: { color: b.color }, tasks: tasks.filter((t) => t.bucket === b.id), defaults: { project: projectId, bucket: b.id } })),
      { key: 'bucket:none', name: 'No bucket', kind: 'bucket', icon: {}, tasks: tasks.filter((t) => !offered.some((b) => b.id === t.bucket)), defaults: { project: projectId } },
    ]
  }
  const offered = projectStatuses(ws, project).map((s) => s.id)
  const used = new Set(tasks.map((t) => statusOf(ws, t.status).id))
  return orderedStatuses(ws)
    .filter((s) => offered.includes(s.id) || used.has(s.id))
    .map((s) => ({ key: `status:${s.id}`, name: s.name, kind: 'status' as GroupBy, icon: { status: s }, tasks: tasks.filter((t) => statusOf(ws, t.status).id === s.id), defaults: { project: projectId, status: s.id } }))
}
