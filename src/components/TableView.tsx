import { ChevronRight } from 'lucide-react'
import { PRIORITY_NAMES } from '../lib/model/defaults'
import type { Task } from '../lib/model/types'
import { identifier, isClosed, projectOf, statusOf } from '../lib/model/workspace'
import { isOverdue } from '../lib/query'
import type { Row } from '../lib/view'
import { useApp, type PickerKind } from './context'
import { EntityIcon, PriorityIcon, StatusIcon } from './icons'
import { GroupIcon } from './TaskList'
import { createdText, Due, Labels } from './ui'

/** The Table layout (kept from the Kanban Board): a column per property and custom field; click a cell to change it. */
export function TableView({ rows, listKey, onOpen, showProject }: { rows: Row[]; listKey: string; onOpen: (t: Task, page: boolean) => void; showProject: boolean }) {
  const { state, store, ui, setUi, actions, now } = useApp()
  const ws = state.ws
  const pick = (kind: PickerKind, task: Task) => !task.archived && setUi({ picker: { kind, ids: ui.selection.includes(task.id) ? ui.selection : [task.id] }, focus: task.id })
  const cell = { padding: '0 10px', borderBottom: '1px solid var(--line)', height: 36, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }
  const head = { ...cell, position: 'sticky' as const, top: 0, background: 'var(--bg-2)', zIndex: 3, textAlign: 'left' as const, fontWeight: 500, color: 'var(--fg-3)', fontSize: 12 }
  const columns = ['ID', 'Status', 'Title', 'Priority', 'Labels', 'Due', ...(showProject ? ['Project'] : []), ...ws.fields.map((f) => f.name), 'Created']
  return (
    <div className="scroll" style={{ overflow: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%', fontSize: 13 }}>
        <thead>
          <tr>{columns.map((c, i) => <th key={c} style={{ ...head, ...(i === 2 ? { left: 0, minWidth: 260, zIndex: 4 } : {}) }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === 'header')
              return (
                <tr key={`h:${row.group.key}`}>
                  <td colSpan={columns.length} style={{ ...cell, background: 'var(--bg-2)', fontWeight: 500 }}>
                    <button style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }} onClick={() => store.toggleCollapsed(listKey, row.group.key)}>
                      <ChevronRight size={13} className={`chev${row.collapsed ? '' : ' open'}`} />
                      <GroupIcon group={row.group} ws={ws} />
                      {row.group.name} <span className="faint num">{row.count}</span>
                    </button>
                  </td>
                </tr>
              )
            if (row.kind === 'closed')
              return (
                <tr key={`c:${row.group}`}>
                  <td colSpan={columns.length} style={{ ...cell, color: 'var(--fg-3)' }}>
                    <button onClick={() => setUi((u) => ({ openClosed: u.openClosed.includes(row.group) ? u.openClosed.filter((g) => g !== row.group) : [...u.openClosed, row.group] }))}>{row.count} closed</button>
                  </td>
                </tr>
              )
            if (row.kind === 'context') return null
            const t = row.task
            const s = statusOf(ws, t.status)
            const p = projectOf(ws, t)
            return (
              <tr key={t.id} data-task-row={t.id} style={{ background: ui.selection.includes(t.id) ? 'var(--selected)' : ui.focus === t.id ? 'var(--hover)' : undefined, opacity: isClosed(ws, t) || t.archived ? 0.6 : 1 }} onMouseMove={() => ui.focus !== t.id && setUi({ focus: t.id })} onContextMenu={(e) => (e.preventDefault(), setUi({ menu: { x: e.clientX, y: e.clientY, ids: ui.selection.includes(t.id) ? ui.selection : [t.id] } }))}>
                <td style={{ ...cell, color: 'var(--fg-4)' }} className="num">{identifier(ws, t)}</td>
                <td style={cell}><button style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={() => pick('status', t)}><StatusIcon category={s.category} color={s.color} />{s.name}</button></td>
                <td style={{ ...cell, position: 'sticky', left: 0, background: 'var(--bg)', paddingLeft: row.depth ? 30 : 10 }}>
                  <button style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => onOpen(t, false)} onDoubleClick={() => onOpen(t, true)}>{t.title}</button>
                </td>
                <td style={cell}><button style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={() => pick('priority', t)}><PriorityIcon priority={t.priority} />{t.priority ? PRIORITY_NAMES[t.priority] : ''}</button></td>
                <td style={cell}><button onClick={() => pick('labels', t)} style={{ minWidth: 40, minHeight: 24 }}><Labels ws={ws} names={t.labels} small /></button></td>
                <td style={cell}><button onClick={() => pick('due', t)} style={{ minWidth: 40, minHeight: 24 }}><Due due={t.due} overdue={isOverdue(ws, t, now)} now={now} /></button></td>
                {showProject && <td style={cell}><button style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={() => !t.parent && pick('project', t)}><EntityIcon name={p?.icon} color={p?.color} size={13} />{p?.name ?? 'No project'}</button></td>}
                {ws.fields.map((f) => (
                  <td key={f.id} style={cell}>
                    <input
                      aria-label={`${f.name} of ${identifier(ws, t)}`}
                      defaultValue={t.fields[f.id] ?? ''}
                      key={`${t.id}:${f.id}:${t.fields[f.id] ?? ''}`}
                      readOnly={!!t.archived || state.locked}
                      list={f.options.length ? `opts-${f.id}` : undefined}
                      onBlur={(e) => e.target.value !== (t.fields[f.id] ?? '') && actions.setCustomField(t.id, f.id, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      style={{ border: 0, background: 'transparent', outline: 'none', width: 120 }}
                    />
                  </td>
                ))}
                <td style={{ ...cell, color: 'var(--fg-4)' }} className="num">{createdText(t.created, now)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {ws.fields.filter((f) => f.options.length).map((f) => (
        <datalist key={f.id} id={`opts-${f.id}`}>{f.options.map((o) => <option key={o.value} value={o.value} />)}</datalist>
      ))}
    </div>
  )
}
