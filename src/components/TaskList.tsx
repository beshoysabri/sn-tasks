import { ChevronRight, ListTree, Plus } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { Task, Workspace } from '../lib/model/types'
import { identifier, isClosed, statusOf, subtaskProgress } from '../lib/model/workspace'
import { isOverdue } from '../lib/query'
import type { Group, Row } from '../lib/view'
import { useApp } from './context'
import { DueIcon, EntityIcon, PriorityIcon, StatusIcon } from './icons'
import { createdText, Due, Labels } from './ui'

export function GroupIcon({ group, ws }: { group: Group; ws: Workspace }) {
  const { icon } = group
  if (icon.status) return <StatusIcon category={icon.status.category} color={icon.status.color} />
  if (icon.priority !== undefined) return <PriorityIcon priority={icon.priority} />
  if (icon.due) return <DueIcon bucket={icon.due} />
  if (icon.projectId) {
    const p = ws.projects.find((x) => x.id === icon.projectId)
    return <EntityIcon name={p?.icon} color={p?.color} size={14} />
  }
  return <i className="dot" style={{ background: icon.color ?? 'var(--fg-4)' }} />
}

interface ListProps {
  rows: Row[]
  listKey: string
  onOpen: (task: Task, page: boolean) => void
  onCreate: (defaults: Group['defaults']) => void
}

export function TaskList({ rows, listKey, onOpen, onCreate }: ListProps) {
  const { state, store, ui, setUi, now } = useApp()
  const ws = state.ws
  const selecting = ui.selection.length > 0
  const idWidth = Math.max(4, ...rows.filter((r) => r.kind === 'task').map((r) => identifier(ws, (r as { task: Task }).task).length))

  const click = (e: MouseEvent, task: Task) => {
    if (e.metaKey || e.ctrlKey) {
      setUi((u) => ({ selection: u.selection.includes(task.id) ? u.selection.filter((s) => s !== task.id) : [...u.selection, task.id], focus: task.id }))
      return
    }
    if (e.shiftKey && ui.focus) {
      const ids = rows.filter((r) => r.kind === 'task').map((r) => (r as { task: Task }).task.id)
      const a = ids.indexOf(ui.focus)
      const b = ids.indexOf(task.id)
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
        setUi((u) => ({ selection: [...new Set([...u.selection, ...range])], focus: task.id }))
        return
      }
    }
    setUi({ focus: task.id })
    onOpen(task, false)
  }

  const menu = (e: MouseEvent, task: Task) => {
    e.preventDefault()
    const ids = ui.selection.includes(task.id) ? ui.selection : [task.id]
    setUi({ menu: { x: e.clientX, y: e.clientY, ids }, focus: task.id })
  }

  return (
    <div className={`list${selecting ? ' selecting' : ''}`} role="list" style={{ ['--id-width' as string]: `${idWidth + 1}ch` }}>
      {rows.map((row) => {
        if (row.kind === 'header') {
          const g = row.group
          return (
            <div key={`h:${g.key}`} className="group" role="listitem">
              <button className="toggle" aria-expanded={!row.collapsed} onClick={() => store.toggleCollapsed(listKey, g.key)}>
                <ChevronRight size={13} className={`chev${row.collapsed ? '' : ' open'}`} aria-hidden />
                <GroupIcon group={g} ws={ws} />
                <span className="name">{g.name}</span>
                <span className="count num">{row.count}</span>
              </button>
              {g.defaults && (
                <button className="icon-btn" title="New task" aria-label={`New ${g.name} task`} onClick={() => onCreate(g.defaults)}>
                  <Plus size={14} />
                </button>
              )}
            </div>
          )
        }
        if (row.kind === 'closed')
          return (
            <button key={`c:${row.group}`} className="closedrow" onClick={() => setUi((u) => ({ openClosed: u.openClosed.includes(row.group) ? u.openClosed.filter((g) => g !== row.group) : [...u.openClosed, row.group] }))}>
              <ChevronRight size={12} className={`chev${row.open ? ' open' : ''}`} aria-hidden />
              <span className="num">{row.count} closed</span>
            </button>
          )
        const task = row.task
        const status = statusOf(ws, task.status)
        const closed = isClosed(ws, task)
        const progress = subtaskProgress(ws, task)
        const context = row.kind === 'context'
        const focused = ui.focus === task.id || ui.peek === task.id
        const checked = ui.selection.includes(task.id)
        const overdue = isOverdue(ws, task, now)
        return (
          <div
            key={`${context ? 'x' : 't'}:${row.group}:${task.id}`}
            role="listitem"
            className={`row${context ? ' context' : ''}${!context && row.depth === 1 ? ' depth1' : ''}`}
            data-task-row={task.id}
            data-focused={focused && !context}
            data-checked={checked}
            data-closed={closed || !!task.archived}
            onMouseMove={() => !context && ui.focus !== task.id && setUi({ focus: task.id })}
            onClick={(e) => click(e, task)}
            onDoubleClick={() => onOpen(task, true)}
            onContextMenu={(e) => !context && menu(e, task)}
          >
            {!context && row.kind === 'task' && row.branch && <span className={`tree ${row.branch}`} aria-hidden />}
            {!context && (
              <span
                className="cb"
                role="checkbox"
                aria-checked={checked}
                aria-label={`Select ${task.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setUi((u) => ({ selection: u.selection.includes(task.id) ? u.selection.filter((s) => s !== task.id) : [...u.selection, task.id] }))
                }}
              />
            )}
            <span className="pri"><PriorityIcon priority={task.priority} /></span>
            <span className="tid num">{identifier(ws, task)}</span>
            <button
              className="status-btn"
              title="Change status (S)"
              aria-label={`Change status of ${task.title}, ${status.name}`}
              disabled={!!task.archived}
              onClick={(e) => {
                e.stopPropagation()
                const ids = ui.selection.includes(task.id) ? ui.selection : [task.id]
                setUi({ picker: { kind: 'status', ids }, focus: task.id })
              }}
            >
              <StatusIcon category={status.category} color={status.color} label={status.name} />
            </button>
            <div className="stack" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span className="title">{task.title}</span>
              <span className="meta phone-meta">
                <span className="num faint">{identifier(ws, task)}</span>
                {task.priority > 0 && <PriorityIcon priority={task.priority} size={12} />}
                {task.labels.slice(0, 2).map((l) => (
                  <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <i className="dot" style={{ background: 'currentColor', opacity: 0.6 }} />
                    {l}
                  </span>
                ))}
                {progress.total > 0 && <span className="subcount"><ListTree size={12} aria-hidden />{progress.done}/{progress.total}</span>}
                <Due due={task.due} overdue={overdue} now={now} />
              </span>
            </div>
            <span className="meta desk-meta">
              {progress.total > 0 && (
                <span className="subcount" title={`${progress.done} of ${progress.total} subtasks done`}>
                  <ListTree size={13} aria-hidden />
                  {progress.done}/{progress.total}
                </span>
              )}
              <Labels ws={ws} names={task.labels} />
              {task.archived && <span className="faint">Archived</span>}
              <Due due={task.due} overdue={overdue} now={now} />
            </span>
            <span className="created num" title={`Created ${new Date(task.created).toLocaleString()}`}>{createdText(task.created, now)}</span>
          </div>
        )
      })}
    </div>
  )
}
