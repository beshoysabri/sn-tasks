import * as chrono from 'chrono-node'
import { Check, Minus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PRIORITY_NAMES, PRIORITY_ORDER } from '../lib/model/defaults'
import type { Priority, Task } from '../lib/model/types'
import { allLabels, identifier, labelColour, normaliseLabel, projectOf, projectStatuses, statusOf, today } from '../lib/model/workspace'
import { useApp, type PickerKind } from './context'
import { EntityIcon, Layers, PriorityIcon, Shapes, StatusIcon } from './icons'
import { dueText } from './ui'

interface Option {
  key: string
  label: string
  icon?: ReactNode
  hint?: string
  /** 'on' = every target has it, 'mixed' = some do. */
  state?: 'on' | 'mixed'
  run: () => void
}

const PLACEHOLDER: Record<PickerKind, string> = {
  status: 'Change status…',
  priority: 'Set priority…',
  labels: 'Add or remove labels…',
  due: 'Set due date… try “Friday” or “Dec 12”',
  project: 'Move to project…',
  type: 'Set type…',
  bucket: 'Move to bucket…',
  cycle: 'Move to cycle…',
  parent: 'Make subtask of…',
}

function addDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return today(d)
}

/** The centred picker S/P/L/D/M/T/B open, for one task or a selection (as in Octarine). */
export function Picker() {
  const { ui, setUi, state, actions, now } = useApp()
  const ws = state.ws
  const picker = ui.picker
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus())
  }, [])

  const targets = useMemo(() => (picker ? picker.ids.map((id) => ws.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t) : []), [picker, ws])
  const close = () => setUi({ picker: null })
  const all = <T,>(get: (t: Task) => T, value: T): Option['state'] => (targets.every((t) => get(t) === value) ? 'on' : targets.some((t) => get(t) === value) ? 'mixed' : undefined)

  const options: Option[] = useMemo(() => {
    if (!picker || !targets.length) return []
    const ids = picker.ids
    const q = query.trim().toLowerCase()
    const pick = (fn: () => void) => () => {
      fn()
      close()
    }
    let list: Option[] = []
    switch (picker.kind) {
      case 'status': {
        const project = projectOf(ws, targets[0])
        list = projectStatuses(ws, project).map((s) => ({
          key: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} />, state: all((t) => statusOf(ws, t.status).id, s.id),
          run: pick(() => actions.setStatus(ids, s.id)),
        }))
        break
      }
      case 'priority':
        list = PRIORITY_ORDER.map((p) => ({ key: String(p), label: PRIORITY_NAMES[p], icon: <PriorityIcon priority={p} />, state: all((t) => t.priority, p), run: pick(() => actions.setPriority(ids, p as Priority)) }))
        break
      case 'labels': {
        const names = allLabels(ws)
        list = names.map((n) => {
          const has = all((t) => t.labels.some((l) => l.toLowerCase() === n.toLowerCase()), true)
          return {
            key: n, label: n, icon: <i className="dot" style={{ background: labelColour(ws, n) }} />, state: has,
            // Labels stay open for several toggles; mixed or none → add to all, all → remove from all.
            run: () => actions.setLabels(ids, has === 'on' ? { remove: [n] } : { add: [n] }),
          }
        })
        const fresh = normaliseLabel(query)
        if (fresh && !names.some((n) => n.toLowerCase() === fresh.toLowerCase()))
          list.push({ key: `new:${fresh}`, label: `Create label “${fresh}”`, run: () => {
            actions.setLabels(ids, { add: [fresh] })
            setQuery('')
          } })
        break
      }
      case 'due': {
        const typed = q ? chrono.parseDate(query, new Date(now), { forwardDate: true }) : null
        if (typed) list.push({ key: 'typed', label: typed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), run: pick(() => actions.setDue(ids, today(typed))) })
        list.push(
          { key: 'today', label: 'Today', hint: dueText(addDays(0), now), run: pick(() => actions.setDue(ids, addDays(0))) },
          { key: 'tomorrow', label: 'Tomorrow', run: pick(() => actions.setDue(ids, addDays(1))) },
          { key: 'week', label: 'Next week', hint: dueText(addDays(7), now), run: pick(() => actions.setDue(ids, addDays(7))) },
        )
        if (targets.some((t) => t.due)) list.push({ key: 'none', label: 'Remove due date', run: pick(() => actions.setDue(ids, undefined)) })
        return list
      }
      case 'project':
        list = [
          ...ws.projects.filter((p) => !p.archived).map((p) => ({ key: p.id, label: p.name, hint: p.key, icon: <EntityIcon name={p.icon} color={p.color} size={14} />, state: all((t) => t.project, p.id), run: pick(() => actions.moveToProject(ids, p.id)) })),
          { key: 'none', label: 'No project', state: all((t) => t.project, undefined), run: pick(() => actions.moveToProject(ids, undefined)) },
        ]
        break
      case 'type':
        list = [
          ...ws.types.map((ty) => ({ key: ty.id, label: ty.name, icon: <Shapes size={14} style={{ color: ty.color }} />, state: all((t) => t.type, ty.id), run: pick(() => actions.setField(ids, 'type', ty.id)) })),
          { key: 'none', label: 'No type', state: all((t) => t.type, undefined), run: pick(() => actions.setField(ids, 'type', undefined)) },
        ]
        break
      case 'bucket':
        list = [
          ...ws.buckets.map((b) => ({ key: b.id, label: b.name, icon: <Layers size={14} style={{ color: b.color }} />, state: all((t) => t.bucket, b.id), run: pick(() => actions.setField(ids, 'bucket', b.id)) })),
          { key: 'none', label: 'No bucket', state: all((t) => t.bucket, undefined), run: pick(() => actions.setField(ids, 'bucket', undefined)) },
        ]
        break
      case 'cycle':
        list = [
          ...ws.cycles.filter((c) => c.state !== 'ended').map((c) => ({ key: c.id, label: c.state === 'upcoming' ? 'Upcoming cycle' : (c.name ?? `Cycle ${c.number}`), hint: `${c.start} – ${c.end}`, state: all((t) => t.cycle, c.id), run: pick(() => actions.setField(ids, 'cycle', c.id)) })),
          { key: 'none', label: 'No cycle', run: pick(() => actions.setField(ids, 'cycle', undefined)) },
        ]
        break
      case 'parent': {
        const own = targets[0].project
        const candidates = ws.tasks
          .filter((t) => !t.archived && !t.parent && !ids.includes(t.id))
          .sort((a, b) => Number(b.project === own) - Number(a.project === own) || b.created.localeCompare(a.created))
          .slice(0, 50)
        list = candidates.map((t) => ({ key: t.id, label: t.title, hint: identifier(ws, t), icon: <StatusIcon category={statusOf(ws, t.status).category} color={statusOf(ws, t.status).color} />, run: pick(() => actions.setParent(ids, t.id)) }))
        if (targets.some((t) => t.parent)) list.unshift({ key: 'none', label: 'Make a regular task', run: pick(() => actions.setParent(ids, undefined)) })
        break
      }
    }
    return q ? list.filter((o) => o.key.startsWith('new:') || o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)) : list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, targets, query, ws, now])

  if (!picker || !targets.length) return null
  const first = targets[0]
  const status = statusOf(ws, first.status)
  return (
    <>
      <div className="scrim" onPointerDown={close} />
      <div
        className="palette"
        role="dialog"
        aria-label={PLACEHOLDER[picker.kind]}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = options.length
            if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            options[Math.min(active, options.length - 1)]?.run()
          }
        }}
      >
        <span className="ctx">
          {targets.length === 1 ? (
            <>
              <StatusIcon category={status.category} color={status.color} size={12} />
              <span className="num">{identifier(ws, first)}</span>
              <span className="faint">· {first.title}</span>
            </>
          ) : (
            <>
              {targets.length} tasks <span className="faint">· {targets.slice(0, 4).map((t) => identifier(ws, t)).join(', ')}{targets.length > 4 ? '…' : ''}</span>
            </>
          )}
        </span>
        <div className="inp">
          <Search size={14} className="faint" aria-hidden />
          <input ref={input} value={query} placeholder={PLACEHOLDER[picker.kind]} onChange={(e) => (setQuery(e.target.value), setActive(0))} aria-label={PLACEHOLDER[picker.kind]} />
        </div>
        <div className="opts" role="listbox">
          {options.map((o, i) => (
            <button key={o.key} role="option" aria-selected={i === active} className="mi" data-active={i === active} onMouseMove={() => setActive(i)} onClick={o.run}>
              {o.icon}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
              <span className="k">
                {o.hint && <span>{o.hint}</span>}
                {o.state === 'on' && <Check size={14} aria-label="current" />}
                {o.state === 'mixed' && <Minus size={14} aria-label="some" />}
              </span>
            </button>
          ))}
          {!options.length && <div className="mhead">{picker.kind === 'due' ? 'Type a date, like “next Friday”.' : 'No results found.'}</div>}
        </div>
      </div>
    </>
  )
}
