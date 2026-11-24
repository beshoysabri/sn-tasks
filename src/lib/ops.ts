/**
 * Every change to the workspace goes through here. An operation edits a draft, which keeps the
 * previous version of everything it touched; that record undoes the change later without
 * disturbing edits that arrived from other devices in between (only touched tasks go back).
 * Task changes also write the task's history (status, priority, due, project…) and timestamps.
 */
import { PRIORITY_NAMES } from './model/defaults'
import type { HistoryEntry, HistoryKind, Priority, Project, Task, Workspace } from './model/types'
import {
  childrenOf,
  doneStatusId,
  isClosedCategory,
  nearestStatusId,
  newId,
  nowStamp,
  projectOf,
  reopenStatusId,
  statusOf,
} from './model/workspace'

type Collections = Omit<Workspace, 'tasks' | 'projects' | 'preamble'>

export interface Change {
  label: string
  /** Previous version of each touched task; null = the task didn't exist. */
  tasks: Map<string, Task | null>
  projects: Map<string, Project | null>
  collections: Partial<Collections>
}

export class Draft {
  readonly tasks: Map<string, Task>
  readonly projects: Map<string, Project>
  private taskOrder: string[]
  private projectOrder: string[]
  readonly change: Change
  collections: Partial<Collections> = {}
  readonly now: string
  readonly base: Workspace

  constructor(base: Workspace, label: string, now = nowStamp()) {
    this.base = base
    this.tasks = new Map(base.tasks.map((t) => [t.id, t]))
    this.projects = new Map(base.projects.map((p) => [p.id, p]))
    this.taskOrder = base.tasks.map((t) => t.id)
    this.projectOrder = base.projects.map((p) => p.id)
    this.change = { label, tasks: new Map(), projects: new Map(), collections: {} }
    this.now = now
  }

  /** The workspace as it stands in the draft (settings included). */
  get ws(): Workspace {
    return { ...this.base, ...this.collections, tasks: [...this.tasks.values()], projects: [...this.projects.values()] }
  }

  task(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  private remember(id: string) {
    if (!this.change.tasks.has(id)) this.change.tasks.set(id, this.tasks.get(id) ?? null)
  }

  putTask(task: Task) {
    this.remember(task.id)
    if (!this.tasks.has(task.id)) this.taskOrder.push(task.id)
    this.tasks.set(task.id, task)
  }

  removeTask(id: string) {
    this.remember(id)
    this.tasks.delete(id)
    this.taskOrder = this.taskOrder.filter((x) => x !== id)
  }

  putProject(project: Project) {
    if (!this.change.projects.has(project.id)) this.change.projects.set(project.id, this.projects.get(project.id) ?? null)
    if (!this.projects.has(project.id)) this.projectOrder.push(project.id)
    this.projects.set(project.id, project)
  }

  removeProject(id: string) {
    if (!this.change.projects.has(id)) this.change.projects.set(id, this.projects.get(id) ?? null)
    this.projects.delete(id)
    this.projectOrder = this.projectOrder.filter((x) => x !== id)
  }

  set<K extends keyof Collections>(key: K, value: Collections[K]) {
    if (!(key in this.change.collections)) (this.change.collections as Record<string, unknown>)[key] = this.base[key]
    this.collections[key] = value
  }

  finish(): { ws: Workspace; change: Change } {
    const ws: Workspace = {
      ...this.base,
      ...this.collections,
      tasks: this.taskOrder.map((id) => this.tasks.get(id)!).filter(Boolean),
      projects: this.projectOrder.map((id) => this.projects.get(id)!).filter(Boolean),
    }
    return { ws, change: this.change }
  }
}

/** Runs an operation; returns the new workspace and how to undo it (null when nothing changed). */
export function run(ws: Workspace, label: string, op: (d: Draft) => void, now?: string): { ws: Workspace; change: Change | null } {
  const draft = new Draft(ws, label, now)
  op(draft)
  const { ws: next, change } = draft.finish()
  const touched = change.tasks.size || change.projects.size || Object.keys(change.collections).length
  return { ws: touched ? next : ws, change: touched ? change : null }
}

/** Puts back what a change touched. Returns the inverse change (for redo). */
export function undo(ws: Workspace, change: Change): { ws: Workspace; change: Change } {
  const draft = new Draft(ws, change.label)
  for (const [id, before] of change.tasks) {
    if (before) draft.putTask(before)
    else draft.removeTask(id)
  }
  for (const [id, before] of change.projects) {
    if (before) draft.putProject(before)
    else draft.removeProject(id)
  }
  for (const [key, value] of Object.entries(change.collections)) draft.set(key as keyof Collections, value as never)
  return draft.finish()
}

// ───────────────────────── task operations ─────────────────────────

function entry(d: Draft, kind: HistoryKind, from?: string, to?: string): HistoryEntry {
  return { at: d.now, kind, from, to }
}

/** Applies a patch to a task, records history for the fields people care about, keeps timestamps. */
export function patchTask(d: Draft, id: string, patch: Partial<Task>, record = true): Task | undefined {
  const task = d.task(id)
  if (!task) return undefined
  const ws = d.ws
  const next: Task = { ...task, ...patch }
  const history = [...task.history]
  const log = (kind: HistoryKind, from?: string, to?: string) => record && history.push(entry(d, kind, from, to))
  if (patch.status !== undefined && patch.status !== task.status) {
    const before = statusOf(ws, task.status)
    const after = statusOf(ws, patch.status)
    log('status', before.name, after.name)
    next.completed = after.category === 'completed' ? d.now : undefined
    next.cancelled = after.category === 'cancelled' ? d.now : undefined
  }
  if (patch.priority !== undefined && patch.priority !== task.priority) log('priority', PRIORITY_NAMES[task.priority], PRIORITY_NAMES[patch.priority])
  if ('due' in patch && patch.due !== task.due) log('due', task.due ?? '', patch.due ?? '')
  if ('title' in patch && patch.title !== task.title && record) log('title', task.title, patch.title)
  if ('labels' in patch && patch.labels!.join(',') !== task.labels.join(',')) log('labels', task.labels.join(', '), patch.labels!.join(', '))
  if ('type' in patch && patch.type !== task.type) log('type', ws.types.find((t) => t.id === task.type)?.name ?? '', ws.types.find((t) => t.id === patch.type)?.name ?? '')
  if ('bucket' in patch && patch.bucket !== task.bucket) log('bucket', ws.buckets.find((b) => b.id === task.bucket)?.name ?? '', ws.buckets.find((b) => b.id === patch.bucket)?.name ?? '')
  if ('cycle' in patch && patch.cycle !== task.cycle) log('cycle', task.cycle ?? '', patch.cycle ?? '')
  next.history = history
  next.updated = d.now
  d.putTask(next)
  return next
}

export interface NewTask {
  title: string
  description?: string
  project?: string
  space?: string
  parent?: string
  status?: string
  priority?: Priority
  labels?: string[]
  due?: string
  type?: string
  bucket?: string
  cycle?: string
  fields?: Record<string, string>
}

/** Creates a task with the next number in its project (or the No-project key). */
export function createTask(d: Draft, input: NewTask, id = newId()): Task {
  const ws = d.ws
  const parent = input.parent ? d.task(input.parent) : undefined
  // A subtask lives in its parent's project; subtasks are one level deep.
  const projectId = parent ? parent.project : input.project
  const project = projectId ? d.projects.get(projectId) : undefined
  let number: number
  if (project) {
    number = project.next
    d.putProject({ ...project, next: project.next + 1 })
  } else {
    number = ws.settings.noProjectNext
    d.set('settings', { ...ws.settings, noProjectNext: number + 1 })
  }
  const type = input.type ? ws.types.find((t) => t.id === input.type) : undefined
  const labels = [...(input.labels ?? [])]
  for (const l of type?.labels ?? []) if (!labels.some((x) => x.toLowerCase() === l.toLowerCase())) labels.push(l)
  const status = input.status ?? reopenStatusId(ws, project)
  const category = statusOf(ws, status).category
  const task: Task = {
    id,
    number,
    project: project?.id,
    space: project ? undefined : (parent?.space ?? input.space),
    parent: parent && !parent.parent ? parent.id : undefined,
    title: input.title.trim() || 'Untitled task',
    description: input.description ?? '',
    status,
    priority: input.priority || type?.priority || 0,
    labels,
    due: input.due,
    type: type?.id,
    bucket: input.bucket,
    cycle: input.cycle ?? parent?.cycle,
    created: d.now,
    updated: d.now,
    completed: category === 'completed' ? d.now : undefined,
    cancelled: category === 'cancelled' ? d.now : undefined,
    aliases: [],
    fields: { ...(input.fields ?? {}) },
    history: [{ at: d.now, kind: 'created' }],
  }
  d.putTask(task)
  return task
}

/** Sets the status; closing a parent can take its open subtasks along (the caller asks first). */
export function setStatus(d: Draft, ids: string[], status: string, withSubtasks = false) {
  for (const id of ids) {
    patchTask(d, id, { status })
    if (!withSubtasks) continue
    const task = d.task(id)!
    if (!isClosedCategory(statusOf(d.ws, status).category)) continue
    for (const kid of childrenOf(d.ws, task)) if (!isClosedCategory(statusOf(d.ws, kid.status).category)) patchTask(d, kid.id, { status })
  }
}

/** Mark as done, or reopen when every target is already done (Octarine's toggle). */
export function toggleDone(d: Draft, ids: string[], withSubtasks = false) {
  const ws = d.ws
  const tasks = ids.map((id) => d.task(id)).filter((t): t is Task => !!t)
  const allDone = tasks.every((t) => statusOf(ws, t.status).category === 'completed')
  for (const t of tasks) {
    const project = projectOf(ws, t)
    if (allDone) patchTask(d, t.id, { status: reopenStatusId(ws, project) })
    else if (statusOf(ws, t.status).category !== 'completed') setStatus(d, [t.id], doneStatusId(ws, project), withSubtasks)
  }
}

export function setLabels(d: Draft, ids: string[], change: { add?: string[]; remove?: string[]; set?: string[] }) {
  for (const id of ids) {
    const task = d.task(id)
    if (!task) continue
    let labels = change.set ? [...change.set] : [...task.labels]
    for (const l of change.add ?? []) if (!labels.some((x) => x.toLowerCase() === l.toLowerCase())) labels.push(l)
    if (change.remove) labels = labels.filter((x) => !change.remove!.some((r) => r.toLowerCase() === x.toLowerCase()))
    patchTask(d, id, { labels })
  }
}

/** Moves tasks to another project (or none): next number there, old ID kept as an alias, subtasks follow. */
export function moveToProject(d: Draft, ids: string[], projectId: string | undefined) {
  const move = (task: Task, target?: Project) => {
    const ws = d.ws
    const from = projectOf(ws, task)
    if (from?.id === target?.id) return
    const oldId = `${from?.key ?? ws.settings.noProjectKey}-${task.number}`
    let number: number
    if (target) {
      const fresh = d.projects.get(target.id)!
      number = fresh.next
      d.putProject({ ...fresh, next: fresh.next + 1 })
    } else {
      number = ws.settings.noProjectNext
      d.set('settings', { ...ws.settings, noProjectNext: number + 1 })
    }
    const status = nearestStatusId(ws, target, task.status)
    const next = patchTask(d, task.id, { project: target?.id, space: undefined, number, status, aliases: [...task.aliases.filter((a) => a !== oldId), oldId] }, false)!
    next.history = [...next.history, entry(d, 'project', from?.name ?? 'No project', target?.name ?? 'No project')]
    d.putTask(next)
  }
  for (const id of ids) {
    const task = d.task(id)
    if (!task || task.parent) continue
    const target = projectId ? d.projects.get(projectId) : undefined
    move(task, target)
    for (const kid of d.ws.tasks.filter((t) => t.parent === id)) move(kid, target)
  }
}

/** Makes tasks subtasks of a parent (one level: a parent can't become a subtask), or regular tasks again. */
export function setParent(d: Draft, ids: string[], parentId: string | undefined) {
  const parent = parentId ? d.task(parentId) : undefined
  if (parent?.parent) return
  for (const id of ids) {
    const task = d.task(id)
    if (!task || id === parentId) continue
    if (parent && d.ws.tasks.some((t) => t.parent === id)) continue
    if (parent && parent.project !== task.project) moveToProject(d, [id], parent.project)
    const fresh = d.task(id)!
    const next = patchTask(d, id, { parent: parent?.id, space: parent ? parent.space : fresh.space }, false)!
    next.history = [...next.history, entry(d, 'parent', '', parent ? parent.title : '')]
    d.putTask(next)
  }
}

export function archiveTasks(d: Draft, ids: string[], archived: boolean) {
  for (const id of ids) {
    const task = d.task(id)
    if (!task || !!task.archived === archived) continue
    const next = patchTask(d, id, { archived: archived ? d.now : undefined }, false)!
    next.history = [...next.history, entry(d, archived ? 'archived' : 'restored')]
    d.putTask(next)
  }
}

/** Deletes tasks for good, with their subtasks. */
export function deleteTasks(d: Draft, ids: string[]) {
  const all = new Set(ids)
  for (const t of d.ws.tasks) if (t.parent && all.has(t.parent)) all.add(t.id)
  for (const id of all) d.removeTask(id)
}

export function addComment(d: Draft, id: string, text: string) {
  const task = d.task(id)
  if (!task || !text.trim()) return
  d.putTask({ ...task, updated: d.now, history: [...task.history, { at: d.now, kind: 'comment', text: text.trim() }] })
}

export function editComment(d: Draft, id: string, index: number, text: string | null) {
  const task = d.task(id)
  const h = task?.history[index]
  if (!task || !h || h.kind !== 'comment') return
  const history = [...task.history]
  if (text === null) history.splice(index, 1)
  else history[index] = { ...h, text: text.trim(), edited: d.now }
  d.putTask({ ...task, updated: d.now, history })
}

/** Sets a manual order between two neighbours (midpoint; ±1024 at the ends). */
export function placeBetween(d: Draft, id: string, before?: Task, after?: Task) {
  const o = (t: Task) => t.order ?? t.number * 1024
  const order = before && after ? (o(before) + o(after)) / 2 : before ? o(before) + 1024 : after ? o(after) - 1024 : 0
  patchTask(d, id, { order }, false)
}
