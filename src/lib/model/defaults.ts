import type { Bucket, Filter, Label, Priority, ProjectStatus, Status, StatusCategory, TaskType, Workspace } from './types'

export const CATEGORIES: StatusCategory[] = ['backlog', 'unstarted', 'started', 'review', 'completed', 'cancelled']

export const CATEGORY_NAMES: Record<StatusCategory, string> = {
  backlog: 'Backlog',
  unstarted: 'To do',
  started: 'In progress',
  review: 'In review',
  completed: 'Done',
  cancelled: 'Cancelled',
}

export const BUILTIN_STATUSES: Status[] = [
  { id: 'backlog', name: 'Backlog', category: 'backlog', builtin: true },
  { id: 'todo', name: 'Todo', category: 'unstarted', builtin: true },
  { id: 'in-progress', name: 'In progress', category: 'started', builtin: true },
  { id: 'in-review', name: 'In review', category: 'review', builtin: true },
  { id: 'done', name: 'Done', category: 'completed', builtin: true },
  { id: 'cancelled', name: 'Cancelled', category: 'cancelled', builtin: true },
]

export const PRIORITY_NAMES: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

/** Urgent first, no priority last. */
export const PRIORITY_ORDER: Priority[] = [1, 2, 3, 4, 0]

export const PROJECT_STATUSES: { id: ProjectStatus; name: string }[] = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'planned', name: 'Planned' },
  { id: 'in-progress', name: 'In progress' },
  { id: 'paused', name: 'Paused' },
  { id: 'completed', name: 'Completed' },
  { id: 'cancelled', name: 'Cancelled' },
]

/** His plugins' shared 18 muted colours (Lemon … Midnight). Labels pick from these. */
export const PALETTE: { name: string; hex: string }[] = [
  { name: 'Lemon', hex: '#FFF689' },
  { name: 'Mustard', hex: '#F4D35E' },
  { name: 'Peach', hex: '#FFB88A' },
  { name: 'Tangerine', hex: '#FF9C5B' },
  { name: 'Flame', hex: '#F67B45' },
  { name: 'Blush', hex: '#FBC2C2' },
  { name: 'Rose', hex: '#E39B99' },
  { name: 'Berry', hex: '#CB7876' },
  { name: 'Sage', hex: '#B4CFA4' },
  { name: 'Fern', hex: '#8BA47C' },
  { name: 'Forest', hex: '#62866C' },
  { name: 'Sky', hex: '#A0C5E3' },
  { name: 'Steel', hex: '#81B2D9' },
  { name: 'Ocean', hex: '#32769B' },
  { name: 'Lavender', hex: '#BBA6DD' },
  { name: 'Mauve', hex: '#8C7DA8' },
  { name: 'Plum', hex: '#64557B' },
  { name: 'Midnight', hex: '#1E2136' },
]

/** Mid-tone palette colours used when a label has no colour of its own (picked by a hash of the name). */
const HASH_COLOURS = ['#CB7876', '#8C7DA8', '#81B2D9', '#8BA47C', '#E39B99', '#F4D35E', '#62866C', '#32769B', '#FF9C5B', '#BBA6DD']

export function hashColour(name: string): string {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0
  return HASH_COLOURS[Math.abs(h) % HASH_COLOURS.length]
}

export const SEED_LABELS: Label[] = [
  { name: 'Bug', color: '#CB7876' },
  { name: 'Feature', color: '#8C7DA8' },
  { name: 'Improvement', color: '#81B2D9' },
]

export const SEED_TYPES: TaskType[] = [
  { id: 'bug', name: 'Bug', color: '#CB7876', labels: [], priority: 0 },
  { id: 'feature', name: 'Feature', color: '#8C7DA8', labels: [], priority: 0 },
  { id: 'improvement', name: 'Improvement', color: '#81B2D9', labels: [], priority: 0 },
]

export const SEED_BUCKETS: Bucket[] = [
  { id: 'now', name: 'Now', color: '#FF9C5B' },
  { id: 'next', name: 'Next', color: '#81B2D9' },
  { id: 'later', name: 'Later' },
]

export const SEED_FILTERS: Filter[] = [
  { id: 'due-this-week', name: 'Due this week', query: 'is:open due:this-week', icon: 'calendar-days' },
  { id: 'recently-completed', name: 'Recently completed', query: 'completed:<7d', icon: 'circle-check', color: '#62866C' },
]

/** A workspace with nothing in it but the built-in vocabulary. */
export function emptyWorkspace(): Workspace {
  return {
    settings: { noProjectKey: 'TASK', noProjectNext: 1, comments: true, weekStart: 0 },
    statuses: BUILTIN_STATUSES.map((s) => ({ ...s })),
    labels: [],
    types: [],
    buckets: [],
    fields: [],
    filters: [],
    cycleSettings: { enabled: false, weeks: 2, startDay: 0 },
    cycles: [],
    spaces: [],
    projects: [],
    tasks: [],
    preamble: '',
  }
}

/** A new workspace as Octarine seeds one: labels, types, buckets and two filters. */
export function seededWorkspace(): Workspace {
  const ws = emptyWorkspace()
  ws.labels = SEED_LABELS.map((l) => ({ ...l }))
  ws.types = SEED_TYPES.map((t) => ({ ...t, labels: [...t.labels] }))
  ws.buckets = SEED_BUCKETS.map((b) => ({ ...b }))
  ws.filters = SEED_FILTERS.map((f) => ({ ...f }))
  return ws
}
