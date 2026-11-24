import { BUILTIN_STATUSES, CATEGORIES, hashColour } from './defaults'
import type { Project, Status, StatusCategory, Task, Workspace } from './types'

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A short random id (6 characters), unique within the workspace in practice. */
export function newId(length = 6): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ID_CHARS[b % ID_CHARS.length]
  // Never start with a digit, so ids can't be confused with numbers.
  return /^[0-9]/.test(out) ? `t${out.slice(1)}` : out
}

export const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,4}$/

/** Octarine's rule: one word → its first three letters, two → two + one, more → initials (up to five). */
export function deriveKey(name: string, taken: string[] = []): string {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  let key =
    words.length >= 3
      ? words.map((w) => w[0]).join('').slice(0, 5)
      : words.length === 2
        ? words[0].slice(0, 2) + words[1][0]
        : (words[0] ?? '').slice(0, 3)
  key = key.replace(/^[0-9]+/, '')
  if (!KEY_PATTERN.test(key) || key.length < 3) key = 'PRJ'
  const used = new Set(taken.map((k) => k.toUpperCase()))
  if (!used.has(key)) return key
  for (let n = 2; n < 100; n++) {
    const candidate = (key.slice(0, 4) + n).slice(0, 5)
    if (!used.has(candidate) && KEY_PATTERN.test(candidate)) return candidate
  }
  return key
}

/** Minute-precision UTC time, the way the note stores it: 2026-11-24T12:02Z */
export function nowStamp(date = new Date()): string {
  return date.toISOString().slice(0, 16) + 'Z'
}

/** Today's date in the device's time zone, YYYY-MM-DD. */
export function today(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isClosedCategory(category: StatusCategory): boolean {
  return category === 'completed' || category === 'cancelled'
}

export function statusIndex(ws: Workspace): Map<string, Status> {
  return new Map(ws.statuses.map((s) => [s.id, s]))
}

/** The status with this id, or Todo when it no longer exists. */
export function statusOf(ws: Workspace, id: string): Status {
  return ws.statuses.find((s) => s.id === id) ?? ws.statuses.find((s) => s.id === 'todo') ?? BUILTIN_STATUSES[1]
}

/** Statuses in workflow order: by category, built-ins first, then in the order they were added. */
export function orderedStatuses(ws: Workspace): Status[] {
  return [...ws.statuses].sort(
    (a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || Number(b.builtin) - Number(a.builtin),
  )
}

export function isClosed(ws: Workspace, task: Task): boolean {
  return isClosedCategory(statusOf(ws, task.status).category)
}

export function projectOf(ws: Workspace, task: Task): Project | undefined {
  return task.project ? ws.projects.find((p) => p.id === task.project) : undefined
}

/** The statuses a project's tasks may use (all when the project doesn't limit them). */
export function projectStatuses(ws: Workspace, project?: Project): Status[] {
  const all = orderedStatuses(ws)
  if (!project?.statuses) return all
  const allowed = all.filter((s) => project.statuses!.includes(s.id))
  return allowed.length ? allowed : all
}

/** First completed-category status the project uses (Done). */
export function doneStatusId(ws: Workspace, project?: Project): string {
  return projectStatuses(ws, project).find((s) => s.category === 'completed')?.id ?? 'done'
}

/** First to-do status the project uses (Todo), else its first open one. */
export function reopenStatusId(ws: Workspace, project?: Project): string {
  const list = projectStatuses(ws, project)
  return (list.find((s) => s.category === 'unstarted') ?? list.find((s) => !isClosedCategory(s.category)))?.id ?? 'todo'
}

/** The default status for a new task in a project. */
export function defaultStatusId(ws: Workspace, project?: Project): string {
  return reopenStatusId(ws, project)
}

/** When a project stops offering a status, its tasks move to the nearest category it keeps. */
export function nearestStatusId(ws: Workspace, project: Project | undefined, statusId: string): string {
  const list = projectStatuses(ws, project)
  if (list.some((s) => s.id === statusId)) return statusId
  const at = CATEGORIES.indexOf(statusOf(ws, statusId).category)
  let best = list[0]
  let bestDistance = Infinity
  for (const s of list) {
    const d = Math.abs(CATEGORIES.indexOf(s.category) - at)
    if (d < bestDistance) {
      best = s
      bestDistance = d
    }
  }
  return best?.id ?? statusId
}

export function keyOf(ws: Workspace, task: Task): string {
  return projectOf(ws, task)?.key ?? ws.settings.noProjectKey
}

/** The visible ID, e.g. WEB-12. */
export function identifier(ws: Workspace, task: Task): string {
  return `${keyOf(ws, task)}-${task.number}`
}

/** Finds a task by its ID or any earlier ID; `#12` matches number 12 in any project. */
export function findByIdentifier(ws: Workspace, ticket: string): Task | undefined {
  const t = ticket.trim().toUpperCase()
  if (t.startsWith('#')) {
    const n = Number(t.slice(1))
    return ws.tasks.find((task) => task.number === n)
  }
  return ws.tasks.find((task) => identifier(ws, task) === t || task.aliases.some((a) => a.toUpperCase() === t))
}

/** The space a task belongs to: its project's, or its own when it has no project. */
export function spaceIdOf(ws: Workspace, task: Task): string | undefined {
  const project = projectOf(ws, task)
  return project ? project.space : task.space
}

export function labelColour(ws: Workspace, name: string): string {
  return ws.labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.color ?? hashColour(name)
}

/** Every label name in use or defined, sorted, case-insensitively unique. */
export function allLabels(ws: Workspace): string[] {
  const byLower = new Map<string, string>()
  for (const l of ws.labels) byLower.set(l.name.toLowerCase(), l.name)
  for (const t of ws.tasks) for (const name of t.labels) if (!byLower.has(name.toLowerCase())) byLower.set(name.toLowerCase(), name)
  return [...byLower.values()].sort((a, b) => a.localeCompare(b))
}

/** Label names are trimmed, spaces become hyphens, commas and quotes go (as in Octarine), 40 characters at most. */
export function normaliseLabel(name: string): string {
  return name.trim().replace(/\s+/g, '-').replace(/[,"]/g, '').slice(0, 40)
}

export function manualOrder(task: Task): number {
  return task.order ?? task.number * 1024
}

export function childrenOf(ws: Workspace, task: Task): Task[] {
  return ws.tasks.filter((t) => t.parent === task.id && !t.archived).sort((a, b) => a.number - b.number)
}

/** Done/total of a parent's subtasks; cancelled ones count in neither. */
export function subtaskProgress(ws: Workspace, task: Task): { done: number; total: number } {
  const kids = childrenOf(ws, task).filter((t) => statusOf(ws, t.status).category !== 'cancelled')
  return { done: kids.filter((t) => statusOf(ws, t.status).category === 'completed').length, total: kids.length }
}
