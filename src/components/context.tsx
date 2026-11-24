import { createContext, useContext } from 'react'
import { PRIORITY_NAMES } from '../lib/model/defaults'
import type { Priority, Task } from '../lib/model/types'
import { doneStatusId, identifier, isClosedCategory, projectOf, statusOf } from '../lib/model/workspace'
import * as ops from '../lib/ops'
import type { NewTask } from '../lib/ops'
import { openChildren } from '../lib/query'
import type { Store, StoreState } from '../lib/store'

export type PickerKind = 'status' | 'priority' | 'labels' | 'due' | 'project' | 'type' | 'bucket' | 'cycle' | 'parent'

export interface Confirm {
  title: string
  body: string
  confirm: string
  danger?: boolean
  run: () => void
}

export interface Ui {
  selection: string[]
  focus: string | null
  peek: string | null
  page: string | null
  picker: { kind: PickerKind; ids: string[] } | null
  creating: Partial<NewTask> | null
  menu: { x: number; y: number; ids: string[] } | null
  confirm: Confirm | null
  drawer: boolean
  search: Record<string, string>
  openClosed: string[]
  help: boolean
  command: boolean
}

export const INITIAL_UI: Ui = {
  selection: [], focus: null, peek: null, page: null, picker: null, creating: null, menu: null, confirm: null, drawer: false,
  search: {}, openClosed: [], help: false, command: false,
}

export interface AppValue {
  store: Store
  state: StoreState
  ui: Ui
  setUi: (patch: Partial<Ui> | ((ui: Ui) => Partial<Ui>)) => void
  actions: Actions
  /** Tasks the list shows right now, in order (for j/k and previous/next). */
  visible: Task[]
  setVisible: (tasks: Task[]) => void
  now: number
}

export const AppContext = createContext<AppValue | null>(null)

export function useApp(): AppValue {
  const v = useContext(AppContext)
  if (!v) throw new Error('useApp outside the app')
  return v
}

export type Actions = ReturnType<typeof makeActions>

/** Everything the UI can do to tasks, with Octarine's prompts and toasts. */
export function makeActions(store: Store, setUi: AppValue['setUi']) {
  const ws = () => store.getSnapshot().ws
  const name = (ids: string[]) => {
    const t = ws().tasks.find((x) => x.id === ids[0])
    return ids.length === 1 && t ? identifier(ws(), t) : `${ids.length} tasks`
  }
  /** Bulk changes get "Updated N tasks · Undo" (Octarine); single ones too, here (every change can be undone). */
  const done = (label: string, ids: string[]) => (ids.length > 1 ? 'undo' : { text: label, action: { label: 'Undo', run: () => store.undo() } }) as Parameters<Store['apply']>[2]

  const setStatus = (ids: string[], status: string) => {
    const w = ws()
    const closing = isClosedCategory(statusOf(w, status).category)
    const parents = closing ? ids.map((id) => w.tasks.find((t) => t.id === id)!).filter((t) => t && openChildren(w, t).some((k) => !ids.includes(k.id))) : []
    const go = (withSubtasks: boolean) => store.apply(ids.length > 1 ? `Updated ${ids.length} tasks` : `${name(ids)} → ${statusOf(w, status).name}`, (d) => ops.setStatus(d, ids, status, withSubtasks), done(`${name(ids)} → ${statusOf(w, status).name}`, ids))
    if (!parents.length) return go(false)
    const open = parents.reduce((n, p) => n + openChildren(w, p).length, 0)
    const statusName = statusOf(w, status).name
    const cancelling = statusOf(w, status).category === 'cancelled'
    setUi({
      confirm: {
        title: cancelling ? 'Cancel subtasks too?' : 'Complete subtasks too?',
        body: parents.length === 1 ? `“${parents[0].title}” has ${open} open subtask${open === 1 ? '' : 's'}. ${open === 1 ? 'It' : 'They'} will be marked ${statusName} as well.` : `These tasks have ${open} open subtasks, which will be marked ${statusName} as well.`,
        confirm: `Mark all ${statusName}`,
        danger: cancelling,
        run: () => go(true),
      },
    })
  }

  return {
    create(input: NewTask): Task | null {
      let created: Task | null = null
      store.apply('Created', (d) => {
        created = ops.createTask(d, input)
      })
      return created
    },
    setStatus,
    toggleDone(ids: string[]) {
      const w = ws()
      const tasks = ids.map((id) => w.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)
      const allDone = tasks.every((t) => statusOf(w, t.status).category === 'completed')
      if (allDone) return store.apply(`Reopened ${name(ids)}`, (d) => ops.toggleDone(d, ids), done(`Reopened ${name(ids)}`, ids))
      const first = tasks[0]
      if (tasks.some((t) => openChildren(w, t).length)) return setStatus(ids, first ? doneStatusId(w, projectOf(w, first)) : 'done')
      store.apply(`${name(ids)} done`, (d) => ops.toggleDone(d, ids), done(`${name(ids)} done`, ids))
    },
    setPriority(ids: string[], priority: Priority) {
      store.apply(`${name(ids)} → ${PRIORITY_NAMES[priority]}`, (d) => ids.forEach((id) => ops.patchTask(d, id, { priority })), done(`${name(ids)} → ${PRIORITY_NAMES[priority]}`, ids))
    },
    setLabels(ids: string[], change: { add?: string[]; remove?: string[] }) {
      store.apply(`Labels of ${name(ids)}`, (d) => ops.setLabels(d, ids, change))
    },
    setDue(ids: string[], due: string | undefined) {
      store.apply(due ? `${name(ids)} due ${due}` : `Removed due date`, (d) => ids.forEach((id) => ops.patchTask(d, id, { due })), done(due ? `${name(ids)} due ${due}` : 'Removed due date', ids))
    },
    moveToProject(ids: string[], projectId: string | undefined) {
      const target = projectId ? ws().projects.find((p) => p.id === projectId) : undefined
      const label = ids.length === 1 ? (target ? `Moved ${name(ids)} to ${target.name}` : `Removed ${name(ids)} from its project`) : `Moved ${ids.length} tasks`
      store.apply(label, (d) => ops.moveToProject(d, ids, projectId), 'undo')
    },
    setField(ids: string[], key: 'type' | 'bucket' | 'cycle', value: string | undefined) {
      store.apply(`Updated ${name(ids)}`, (d) => ids.forEach((id) => ops.patchTask(d, id, { [key]: value })), done(`Updated ${name(ids)}`, ids))
    },
    setCustomField(id: string, fieldId: string, value: string) {
      const t = ws().tasks.find((x) => x.id === id)
      if (!t) return
      store.apply('Field', (d) => ops.patchTask(d, id, { fields: { ...t.fields, [fieldId]: value } }, false))
    },
    setParent(ids: string[], parentId: string | undefined) {
      store.apply(parentId ? `Made ${name(ids)} a subtask` : `${name(ids)} is now a regular task`, (d) => ops.setParent(d, ids, parentId), 'undo')
    },
    rename(id: string, title: string) {
      const t = ws().tasks.find((x) => x.id === id)
      if (!t || !title.trim() || t.title === title.trim()) return
      store.apply('Renamed', (d) => ops.patchTask(d, id, { title: title.trim() }, false))
    },
    describe(id: string, description: string) {
      const t = ws().tasks.find((x) => x.id === id)
      if (!t || t.description === description) return
      store.apply('Description', (d) => ops.patchTask(d, id, { description }, false))
    },
    comment(id: string, text: string) {
      store.apply('Comment', (d) => ops.addComment(d, id, text))
    },
    editComment(id: string, index: number, text: string | null) {
      store.apply(text === null ? 'Deleted comment' : 'Edited comment', (d) => ops.editComment(d, id, index, text))
    },
    archive(ids: string[], archived: boolean) {
      store.apply(archived ? (ids.length > 1 ? `Archived ${ids.length} tasks` : `Archived ${name(ids)}`) : ids.length > 1 ? `Restored ${ids.length} tasks` : `Restored ${name(ids)}`, (d) => ops.archiveTasks(d, ids, archived), 'undo')
      setUi((ui) => ({ selection: ui.selection.filter((s) => !ids.includes(s)) }))
    },
    remove(ids: string[]) {
      const w = ws()
      const kids = w.tasks.filter((t) => t.parent && ids.includes(t.parent) && !ids.includes(t.id)).length
      const one = ids.length === 1
      setUi({
        confirm: {
          title: one ? `Delete task ${name(ids)}` : `Delete ${ids.length} tasks`,
          body: `${one ? 'This task' : 'These tasks'}${kids ? ` and ${kids} subtask${kids === 1 ? '' : 's'}` : ''} will be deleted, along with comments and history. You can undo this until you close the note.`,
          confirm: one ? 'Delete task' : 'Delete tasks',
          danger: true,
          run: () => {
            store.apply(one ? `Deleted ${name(ids)}` : `Deleted ${ids.length} tasks`, (d) => ops.deleteTasks(d, ids), 'undo')
            setUi((ui) => ({ selection: ui.selection.filter((s) => !ids.includes(s)), peek: ids.includes(ui.peek ?? '') ? null : ui.peek, page: ids.includes(ui.page ?? '') ? null : ui.page }))
          },
        },
      })
    },
    reorder(id: string, before?: Task, after?: Task) {
      store.apply('Moved', (d) => ops.placeBetween(d, id, before, after))
    },
  }
}
