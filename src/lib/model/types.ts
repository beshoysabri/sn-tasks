/**
 * The workspace a Tasks note holds. One note = one workspace: settings, spaces,
 * projects and tasks. Everything is plain data so it can be written to the note's
 * Markdown (lib/format) and merged task by task (lib/merge).
 */

/** Status categories in workflow order; a status's category sets its icon and whether it counts as open. */
export type StatusCategory = 'backlog' | 'unstarted' | 'started' | 'review' | 'completed' | 'cancelled'

export interface Status {
  id: string
  name: string
  category: StatusCategory
  /** Hex colour; empty means the category's default. */
  color?: string
  builtin: boolean
}

/** 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low. */
export type Priority = 0 | 1 | 2 | 3 | 4

export interface Label {
  name: string
  color?: string
}

/** A hand-sorted lane such as Now, Next or Later. */
export interface Bucket {
  id: string
  name: string
  color?: string
}

/** What kind of work a task is. Giving a task a type adds its labels and sets its priority if it has none. */
export interface TaskType {
  id: string
  name: string
  color?: string
  labels: string[]
  priority: Priority
}

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'url' | 'media' | 'checkbox'

export interface FieldOption {
  value: string
  color?: string
}

/** A custom property defined for the workspace (kept from the Kanban Board). */
export interface Field {
  id: string
  name: string
  type: FieldType
  options: FieldOption[]
}

export interface Link {
  title: string
  url: string
}

export interface Space {
  id: string
  name: string
  icon?: string
  color?: string
  labels: string[]
  description: string
  links: Link[]
  archived: boolean
}

export type ProjectStatus = 'backlog' | 'planned' | 'in-progress' | 'paused' | 'completed' | 'cancelled'

export interface Project {
  id: string
  name: string
  /** 2–5 letters or digits starting with a letter, e.g. WEB. */
  key: string
  /** The number the next task in this project gets. Numbers are never reused. */
  next: number
  icon?: string
  color?: string
  status: ProjectStatus
  priority: Priority
  start?: string
  target?: string
  /** Labels on the project itself. */
  labels: string[]
  space?: string
  /** Status ids its tasks may use; undefined = all. */
  statuses?: string[]
  /** Label names its tasks may pick; undefined = all. */
  labelsOffered?: string[]
  /** Bucket ids its tasks may use; undefined = all. */
  buckets?: string[]
  description: string
  links: Link[]
  archived: boolean
  pinned: boolean
  /** The saved search of the project's Tasks tab. */
  query?: string
}

export type CycleState = 'upcoming' | 'active' | 'ended'

export interface CycleStats {
  planned: number
  plannedCompleted: number
  completed: number
  cancelled: number
  added: number
  carried: number
  returned: number
}

export interface Cycle {
  id: string
  number: number
  name?: string
  start: string
  end: string
  state: CycleState
  goal?: string
  planned: string[]
  stats?: CycleStats
}

export interface CycleSettings {
  enabled: boolean
  /** 1–4 weeks. */
  weeks: number
  /** 0 = Monday … 6 = Sunday. */
  startDay: number
}

export interface Filter {
  id: string
  name: string
  query: string
  icon?: string
  color?: string
  /** Scope: a project id, a space id, or neither (shared: shown in the sidebar). */
  project?: string
  space?: string
}

export type HistoryKind =
  | 'created'
  | 'comment'
  | 'status'
  | 'priority'
  | 'due'
  | 'project'
  | 'labels'
  | 'type'
  | 'bucket'
  | 'cycle'
  | 'parent'
  | 'title'
  | 'archived'
  | 'restored'

/** One line of a task's history; comments are history entries with text. */
export interface HistoryEntry {
  /** ISO time, minute precision, UTC: 2026-11-24T12:02Z */
  at: string
  kind: HistoryKind
  from?: string
  to?: string
  /** Comment text (Markdown). */
  text?: string
  /** When a comment was edited (ISO). */
  edited?: string
}

export interface Task {
  /** Short stable id, never shown; survives moves and renumbering. */
  id: string
  /** Number inside its project (or the No-project key). */
  number: number
  project?: string
  /** Only for tasks outside any project. */
  space?: string
  parent?: string
  title: string
  description: string
  status: string
  priority: Priority
  labels: string[]
  due?: string
  type?: string
  bucket?: string
  cycle?: string
  created: string
  updated: string
  completed?: string
  cancelled?: string
  archived?: string
  /** Manual order; undefined = number × 1024. */
  order?: number
  /** Earlier IDs (WEB-12) that still find this task after a move or a key change. */
  aliases: string[]
  /** Custom field values by field id. */
  fields: Record<string, string>
  history: HistoryEntry[]
}

export interface Settings {
  /** Key for tasks without a project, default TASK. */
  noProjectKey: string
  noProjectNext: number
  comments: boolean
}

export interface Workspace {
  settings: Settings
  statuses: Status[]
  labels: Label[]
  types: TaskType[]
  buckets: Bucket[]
  fields: Field[]
  filters: Filter[]
  cycleSettings: CycleSettings
  cycles: Cycle[]
  spaces: Space[]
  projects: Project[]
  tasks: Task[]
  /** Text before the first heading that the reader didn't recognise; written back unchanged. */
  preamble: string
}
