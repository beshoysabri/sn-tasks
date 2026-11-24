/**
 * The app's state: the open note's workspace, what to save and when, undo, merging what arrives from
 * other devices, toasts, and the per-note view state kept in component data.
 *
 * Saving rules (from Money Month): only after a user action, ~300 ms after the last one, flushed when
 * the page hides or the editor loses focus; never on load; never into a locked note; each save names
 * its note. The last saved (or received) text is the merge base.
 */
import { isKanbanNote, readKanban } from './format/kanban'
import { previewLine, readNote, writeNote } from './format/note'
import { merge, same } from './merge'
import { seededWorkspace } from './model/defaults'
import type { Workspace } from './model/types'
import { deriveKey, newId, nowStamp, today } from './model/workspace'
import { run, undo as undoChange, type Change, type Draft } from './ops'
import type { Direction, Ordering } from './query'
import type { BridgeState, StandardNotesBridge } from './sn/bridge'

export type NoteKind = 'loading' | 'tasks' | 'kanban' | 'empty' | 'other'

export type GroupBy = 'status' | 'priority' | 'type' | 'bucket' | 'due' | 'project' | 'none'
export type Layout = 'list' | 'board' | 'table'

export interface DisplayOptions {
  layout: Layout
  groupBy: GroupBy
  columns: 'status' | 'bucket'
  wrap: boolean
  ordering: Ordering
  direction: Direction
}

export const DEFAULT_DISPLAY: DisplayOptions = { layout: 'list', groupBy: 'status', columns: 'status', wrap: false, ordering: 'manual', direction: 'asc' }

/** A list's display options: saved ones over the defaults (filters and spaces group by project). */
export function resolveDisplay(saved: Record<string, DisplayOptions>, key: string): DisplayOptions {
  return { ...DEFAULT_DISPLAY, ...(key.startsWith('filter:') || key.startsWith('space:') ? { groupBy: 'project' as GroupBy } : {}), ...saved[key] }
}

/** Where the main area is. */
export type Location =
  | { kind: 'project'; id: string; tab: string }
  | { kind: 'space'; id: string; tab: string }
  | { kind: 'filter'; id: string }
  | { kind: 'cycle'; id: string }
  | { kind: 'no-project' }
  | { kind: 'archived' }
  | { kind: 'settings'; page: string }

export interface ViewState {
  location?: Location
  display: Record<string, DisplayOptions>
  collapsed: Record<string, string[]>
  sidebar: boolean
  peekWidth: number
  /** The new-task dialog's "Create more" switch. */
  createMore?: boolean
}

export const DEFAULT_VIEW: ViewState = { display: {}, collapsed: {}, sidebar: true, peekWidth: 480 }

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export interface Conflict {
  id: string
  remote: { title: string; description: string }
}

export interface StoreState {
  kind: NoteKind
  ws: Workspace
  title: string
  locked: boolean
  otherText: string
  warnings: string[]
  conflicts: Conflict[]
  canUndo: boolean
  canRedo: boolean
  toast: Toast | null
  view: ViewState
  /** An old Kanban board read but not yet saved in the Tasks format. */
  converting: boolean
}

const SAVE_DELAY = 300
const VIEW_DELAY = 1500
const MAX_NOTES_IN_VIEW_STATE = 20

export class Store {
  private state: StoreState
  private listeners = new Set<() => void>()
  private uuid: string | null = null
  private lastText = ''
  private base: Workspace
  private dirty = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private viewTimer: ReturnType<typeof setTimeout> | null = null
  private undoStack: Change[] = []
  private redoStack: Change[] = []
  private toastSeq = 0
  private viewStates: Record<string, ViewState> = {}
  private readonly bridge: StandardNotesBridge | null

  constructor(bridge: StandardNotesBridge | null, demo?: Workspace) {
    this.bridge = bridge
    const ws = demo ?? seededWorkspace()
    this.base = ws
    this.state = {
      kind: bridge ? 'loading' : 'tasks', ws, title: demo ? 'Personal tasks' : '', locked: false, otherText: '', warnings: [], conflicts: [],
      canUndo: false, canRedo: false, toast: null, view: { ...DEFAULT_VIEW }, converting: false,
    }
    if (bridge) {
      bridge.subscribe(() => this.onBridge(bridge.getSnapshot()))
      this.onBridge(bridge.getSnapshot())
    }
    if (typeof window !== 'undefined') {
      const flush = () => this.flush()
      window.addEventListener('pagehide', flush)
      window.addEventListener('blur', flush)
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.flush())
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): StoreState => this.state

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  // ─────────────── Standard Notes ───────────────

  private onBridge(b: BridgeState) {
    if (b.registered && b.componentData && typeof b.componentData.notes === 'object' && b.componentData.notes && !Object.keys(this.viewStates).length) {
      this.viewStates = b.componentData.notes as Record<string, ViewState>
    }
    const note = b.note
    if (!note) return
    if (note.uuid !== this.uuid) {
      this.flush()
      this.uuid = note.uuid
      this.load(note.text)
      this.set({ title: note.title, locked: note.locked, view: { ...DEFAULT_VIEW, ...this.viewStates[note.uuid] } })
      return
    }
    if (note.title !== this.state.title || note.locked !== this.state.locked) this.set({ title: note.title, locked: note.locked })
    if (note.text !== this.lastText) this.receiveRemote(note.text)
  }

  private load(text: string) {
    this.undoStack = []
    this.redoStack = []
    this.dirty = false
    this.lastText = text
    const read = readNote(text)
    if (read.kind === 'tasks') {
      this.base = read.workspace
      this.set({ kind: 'tasks', ws: read.workspace, warnings: read.warnings, conflicts: [], converting: false, canUndo: false, canRedo: false })
    } else if (read.kind === 'empty') {
      this.base = read.workspace
      this.set({ kind: 'empty', ws: read.workspace, warnings: [], conflicts: [], converting: false, canUndo: false, canRedo: false })
    } else if (isKanbanNote(text)) {
      const k = readKanban(text, nowStamp())
      this.base = k.workspace
      const project = k.workspace.projects[0]
      const display = { ...DEFAULT_DISPLAY, layout: k.view === 'board' ? 'board' : k.view === 'table' ? 'table' : 'list' } as DisplayOptions
      this.set({
        kind: 'kanban', ws: k.workspace, warnings: k.warnings, conflicts: [], converting: true, canUndo: false, canRedo: false,
        view: { ...this.state.view, location: { kind: 'project', id: project.id, tab: 'tasks' }, display: { [`project:${project.id}`]: display } },
      })
    } else {
      this.base = read.workspace
      this.set({ kind: 'other', ws: read.workspace, otherText: text, warnings: read.warnings, conflicts: [], converting: false })
    }
  }

  private receiveRemote(text: string) {
    const read = readNote(text)
    if (read.kind !== 'tasks' || (this.state.kind !== 'tasks' && this.state.kind !== 'kanban')) {
      this.load(text)
      return
    }
    const { ws, conflicts } = merge(this.base, this.state.ws, read.workspace)
    this.base = read.workspace
    this.lastText = text
    const known = new Set(this.state.conflicts.map((c) => c.id))
    this.set({ ws, kind: 'tasks', converting: false, conflicts: [...this.state.conflicts, ...conflicts.filter((c) => !known.has(c.id))] })
    if (!same(ws, read.workspace)) this.scheduleSave()
  }

  get readonly(): boolean {
    return this.state.locked
  }

  private scheduleSave() {
    if (!this.bridge) return
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY)
  }

  /** Saves now if anything is waiting. */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty || !this.bridge || !this.uuid || this.state.locked) return
    const ws = this.state.ws
    const text = writeNote(ws)
    this.dirty = false
    if (text === this.lastText) return
    // Record what is being saved first: the bridge echoes the save back synchronously, and that
    // echo must not look like a change from another device.
    const before = { text: this.lastText, base: this.base }
    const converting = this.state.converting
    this.lastText = text
    this.base = ws
    if (!this.bridge.save(this.uuid, text, previewLine(ws, today()))) {
      this.lastText = before.text
      this.base = before.base
      return
    }
    if (converting) {
      this.set({ converting: false, kind: 'tasks' })
      this.toast('This board is now saved in the Tasks format.')
    }
  }

  // ─────────────── changes ───────────────

  /** Applies an operation, keeps it for Undo and saves. */
  apply(label: string, op: (d: Draft) => void, toast?: { text: string; action?: Toast['action'] } | 'undo'): boolean {
    if (this.state.locked) {
      this.toast('This note is locked, so it can’t be changed.')
      return false
    }
    const { ws, change } = run(this.state.ws, label, op)
    if (!change) return false
    this.undoStack.push(change)
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.redoStack = []
    this.set({ ws, canUndo: true, canRedo: false })
    this.scheduleSave()
    if (toast === 'undo') this.toast(label, { label: 'Undo', run: () => this.undo() })
    else if (toast) this.toast(toast.text, toast.action)
    return true
  }

  undo() {
    const change = this.undoStack.pop()
    if (!change) return
    const { ws, change: inverse } = undoChange(this.state.ws, change)
    this.redoStack.push(inverse)
    this.set({ ws, canUndo: this.undoStack.length > 0, canRedo: true })
    this.scheduleSave()
  }

  redo() {
    const change = this.redoStack.pop()
    if (!change) return
    const { ws, change: inverse } = undoChange(this.state.ws, change)
    this.undoStack.push(inverse)
    this.set({ ws, canUndo: true, canRedo: this.redoStack.length > 0 })
    this.scheduleSave()
  }

  /** Turns an empty (or non-task) note into a task list; existing text stays at the top. */
  start(projectName: string) {
    if (this.state.locked) return
    const ws = seededWorkspace()
    ws.preamble = this.state.kind === 'other' ? this.state.otherText.trim() : ''
    const name = projectName.trim() || 'My project'
    const id = newId()
    ws.projects.push({ id, name, key: deriveKey(name), next: 1, status: 'in-progress', priority: 0, labels: [], description: '', links: [], archived: false, pinned: false })
    this.base = ws
    this.set({ kind: 'tasks', ws, view: { ...this.state.view, location: { kind: 'project', id, tab: 'tasks' } } })
    this.dirty = true
    this.flush()
  }

  /** "Keep mine": the local text stays and is saved. "Discard mine": take the other device's text. */
  resolveConflict(id: string, keepMine: boolean) {
    const conflict = this.state.conflicts.find((c) => c.id === id)
    this.set({ conflicts: this.state.conflicts.filter((c) => c.id !== id) })
    if (!conflict || keepMine) return
    const { ws } = run(this.state.ws, 'Discard mine', (d) => {
      const task = d.task(id)
      if (task) d.putTask({ ...task, title: conflict.remote.title, description: conflict.remote.description })
    })
    this.set({ ws })
    this.scheduleSave()
  }

  // ─────────────── toasts and view state ───────────────

  toast(text: string, action?: Toast['action']) {
    this.set({ toast: { id: ++this.toastSeq, text, action } })
  }

  dismissToast(id: number) {
    if (this.state.toast?.id === id) this.set({ toast: null })
  }

  setView(patch: Partial<ViewState>) {
    const view = { ...this.state.view, ...patch }
    this.set({ view })
    if (!this.uuid || !this.bridge || this.state.locked) return
    this.viewStates = { ...this.viewStates, [this.uuid]: view }
    const keys = Object.keys(this.viewStates)
    if (keys.length > MAX_NOTES_IN_VIEW_STATE) for (const k of keys.slice(0, keys.length - MAX_NOTES_IN_VIEW_STATE)) delete this.viewStates[k]
    if (this.viewTimer) clearTimeout(this.viewTimer)
    this.viewTimer = setTimeout(() => this.bridge?.setComponentData({ notes: this.viewStates }), VIEW_DELAY)
  }

  display(key: string): DisplayOptions {
    return resolveDisplay(this.state.view.display, key)
  }

  setDisplay(key: string, patch: Partial<DisplayOptions>) {
    this.setView({ display: { ...this.state.view.display, [key]: { ...this.display(key), ...patch } } })
  }

  toggleCollapsed(key: string, group: string) {
    const list = this.state.view.collapsed[key] ?? []
    const next = list.includes(group) ? list.filter((g) => g !== group) : [...list, group]
    this.setView({ collapsed: { ...this.state.view.collapsed, [key]: next } })
  }
}
