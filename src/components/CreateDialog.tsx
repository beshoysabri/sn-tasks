import { CalendarDays, ChevronRight, Tag, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PRIORITY_NAMES, PRIORITY_ORDER } from '../lib/model/defaults'
import type { Priority } from '../lib/model/types'
import { allLabels, defaultStatusId, identifier, isClosedCategory, labelColour, projectStatuses, statusOf } from '../lib/model/workspace'
import type { NewTask } from '../lib/ops'
import { completeTitle, parseTitle, tokenKey, type Token } from '../lib/quickadd'
import { useApp } from './context'
import { EntityIcon, Layers, PriorityIcon, Shapes, StatusIcon } from './icons'
import { dueText, useDismiss } from './ui'

let draft: { title: string; description: string } | null = null

interface ChipOption {
  key: string
  label: string
  icon?: ReactNode
  on?: boolean
}

function ChipMenu({ open, onClose, options, onPick, multi }: { open: boolean; onClose: () => void; options: ChipOption[]; onPick: (key: string) => void; multi?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  useDismiss(ref, onClose, open)
  useEffect(() => {
    if (open) requestAnimationFrame(() => ref.current?.focus())
  }, [open])
  if (!open) return null
  return (
    <div
      ref={ref}
      className="menu"
      tabIndex={-1}
      style={{ position: 'absolute', top: 34, left: 0 }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onPick(options[active].key)
          if (!multi) onClose()
        }
      }}
    >
      {options.map((o, i) => (
        <button key={o.key} className="mi" data-active={i === active} onMouseMove={() => setActive(i)} onClick={() => (onPick(o.key), !multi && onClose())}>
          {o.icon}
          {o.label}
          <span className="k">{o.on ? '✓' : ''}</span>
        </button>
      ))}
    </div>
  )
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function CreateDialog({ init }: { init: Partial<NewTask> }) {
  const { setUi, state, store, actions, now } = useApp()
  const ws = state.ws
  const [title, setTitle] = useState(draft?.title ?? '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [fields, setFields] = useState<Partial<NewTask>>({ ...init })
  const [kept, setKept] = useState<string[]>([])
  const [menu, setMenu] = useState<string | null>(null)
  const [restored, setRestored] = useState(!!draft)
  const createMore = !!state.view.createMore
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus())
  }, [])

  const labels = useMemo(() => allLabels(ws), [ws])
  const parsed = useMemo(() => parseTitle(title, { knownLabels: labels, keptAsText: kept, now: new Date(now) }), [title, labels, kept, now])
  const completion = useMemo(() => completeTitle(title, labels), [title, labels])

  const project = fields.project ? ws.projects.find((p) => p.id === fields.project) : undefined
  const parent = fields.parent ? ws.tasks.find((t) => t.id === fields.parent) : undefined
  const status = statusOf(ws, fields.status ?? defaultStatusId(ws, project))
  const priority = (parsed.priority ?? fields.priority ?? 0) as Priority
  const due = parsed.due ?? fields.due
  const allChosenLabels = [...new Set([...(fields.labels ?? []), ...parsed.labels])]
  const type = ws.types.find((t) => t.id === fields.type)
  const bucket = ws.buckets.find((b) => b.id === fields.bucket)

  const close = () => {
    draft = title.trim() || description.trim() ? { title, description } : null
    setUi({ creating: null })
  }
  const submit = () => {
    if (!parsed.title.trim()) return
    const task = actions.create({ ...fields, title: parsed.title, description, priority, due, labels: allChosenLabels, status: status.id })
    draft = null
    if (task) {
      const t = store.getSnapshot().ws.tasks.find((x) => x.id === task.id)
      if (t) store.toast(`Created ${identifier(store.getSnapshot().ws, t)}`, { label: 'Open', run: () => setUi({ page: t.id, peek: null, focus: t.id }) })
    }
    if (createMore) {
      setTitle('')
      setDescription('')
      setKept([])
      requestAnimationFrame(() => input.current?.focus())
    } else setUi({ creating: null })
  }

  const chip = (name: string, set: boolean, icon: ReactNode, text: string, options: ChipOption[], onPick: (k: string) => void, multi = false) => (
    <span style={{ position: 'relative', order: set ? 1 : 3 }}>
      <button type="button" className={`chip${set ? '' : ' unset'}`} title={`${name} (${isMac ? '⌃' : 'Alt'}+${name === 'Labels' ? 'L' : name === 'Due date' ? 'D' : name[0]})`} aria-label={`${name}${set ? `: ${text}` : ''}`} onClick={() => setMenu(menu === name ? null : name)}>
        {icon}
        {set && text}
      </button>
      <ChipMenu open={menu === name} onClose={() => setMenu(null)} options={options} onPick={onPick} multi={multi} />
    </span>
  )

  const segments: { text: string; token?: Token }[] = []
  let at = 0
  for (const t of parsed.tokens) {
    if (t.start > at) segments.push({ text: title.slice(at, t.start) })
    segments.push({ text: title.slice(t.start, t.end), token: t })
    at = t.end
  }
  if (at < title.length) segments.push({ text: title.slice(at) })
  const hotkeys: Record<string, string> = { S: 'Status', P: 'Priority', T: 'Type', B: 'Bucket', L: 'Labels', D: 'Due date', M: 'Project' }

  return (
    <>
      <div className="scrim" onPointerDown={close} />
      <form
        className="dialog"
        role="dialog"
        aria-label="New task"
        onSubmit={(e) => (e.preventDefault(), submit())}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !menu) {
            e.preventDefault()
            close()
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
          const mod = isMac ? e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey
          const letter = e.code.startsWith('Key') ? e.code.slice(3) : ''
          if (mod && !e.metaKey && !e.shiftKey && hotkeys[letter]) {
            e.preventDefault()
            setMenu(hotkeys[letter] === 'Project' ? 'Project' : hotkeys[letter])
          }
        }}
      >
        <div className="dlg-crumb">
          <span style={{ position: 'relative' }}>
            <button type="button" className="proj" onClick={() => setMenu(menu === 'Project' ? null : 'Project')} disabled={!!parent}>
              <EntityIcon name={project?.icon} color={project?.color} size={13} />
              {project?.name ?? 'No project'}
            </button>
            <ChipMenu
              open={menu === 'Project'}
              onClose={() => setMenu(null)}
              options={[...ws.projects.filter((p) => !p.archived).map((p) => ({ key: p.id, label: p.name, icon: <EntityIcon name={p.icon} color={p.color} size={14} />, on: p.id === fields.project })), { key: '', label: 'No project', on: !fields.project }]}
              onPick={(k) => setFields((f) => ({ ...f, project: k || undefined, status: undefined }))}
            />
          </span>
          <ChevronRight size={12} />
          {parent ? <>Subtask of <span className="num">{identifier(ws, parent)}</span></> : 'New task'}
          {restored && <button type="button" className="btn ghost" style={{ marginLeft: 'auto', height: 24 }} onClick={() => (setTitle(''), setDescription(''), setRestored(false), (draft = null))}>Discard draft</button>}
          <button type="button" className="icon-btn" style={{ marginLeft: restored ? 0 : 'auto' }} aria-label="Close" onClick={close}><X size={15} /></button>
        </div>
        <div className="dlg-title">
          <div className="mirror" aria-hidden>
            {segments.map((s, i) => <span key={i} className={s.token ? `tok-${s.token.kind}` : undefined}>{s.text}</span>)}
            {completion && <span className="ghost">{completion.ghost}</span>}
            {!title && <span>&nbsp;</span>}
          </div>
          <input
            ref={input}
            aria-label="Task title"
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              const atEnd = e.currentTarget.selectionStart === title.length
              if (completion && atEnd && (e.key === 'Tab' || e.key === 'ArrowRight') && !e.shiftKey) {
                e.preventDefault()
                setTitle(completion.value)
              } else if (e.key === 'Backspace' && atEnd) {
                const t = parsed.tokens.find((x) => x.end === title.length && x.kind !== 'label')
                if (t) {
                  e.preventDefault()
                  setKept((k) => [...k, tokenKey(t.kind, title.slice(t.start, t.end))])
                }
              } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <textarea className="dlg-desc" rows={1} placeholder="Add a description…" aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="chiprow">
          {chip('Status', true, <StatusIcon category={status.category} color={status.color} />, status.name,
            projectStatuses(ws, project).map((s) => ({ key: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} />, on: s.id === status.id })),
            (k) => setFields((f) => ({ ...f, status: k })))}
          {chip('Priority', priority > 0, <PriorityIcon priority={priority} />, PRIORITY_NAMES[priority],
            PRIORITY_ORDER.map((p) => ({ key: String(p), label: PRIORITY_NAMES[p], icon: <PriorityIcon priority={p} />, on: p === priority })),
            (k) => setFields((f) => ({ ...f, priority: Number(k) as Priority })))}
          {ws.types.length > 0 && chip('Type', !!type, <Shapes size={14} style={{ color: type?.color }} />, type?.name ?? '',
            [...ws.types.map((t) => ({ key: t.id, label: t.name, icon: <Shapes size={14} style={{ color: t.color }} />, on: t.id === fields.type })), { key: '', label: 'No type' }],
            (k) => setFields((f) => ({ ...f, type: k || undefined })))}
          {ws.buckets.length > 0 && chip('Bucket', !!bucket, <Layers size={14} style={{ color: bucket?.color }} />, bucket?.name ?? '',
            [...ws.buckets.map((b) => ({ key: b.id, label: b.name, icon: <Layers size={14} style={{ color: b.color }} />, on: b.id === fields.bucket })), { key: '', label: 'No bucket' }],
            (k) => setFields((f) => ({ ...f, bucket: k || undefined })))}
          {chip('Labels', allChosenLabels.length > 0, allChosenLabels.length ? <i className="dot" style={{ background: labelColour(ws, allChosenLabels[0]) }} /> : <Tag size={14} />, allChosenLabels.join(', '),
            labels.map((l) => ({ key: l, label: l, icon: <i className="dot" style={{ background: labelColour(ws, l) }} />, on: allChosenLabels.includes(l) })),
            (k) => setFields((f) => ({ ...f, labels: (f.labels ?? []).includes(k) ? (f.labels ?? []).filter((x) => x !== k) : [...(f.labels ?? []), k] })), true)}
          {chip('Due date', !!due, <CalendarDays size={14} />, due ? dueText(due, now) : '',
            [0, 1, 7].map((n) => {
              const d = new Date(now)
              d.setDate(d.getDate() + n)
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              return { key: iso, label: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'Next week', on: iso === due }
            }).concat(due ? [{ key: '', label: 'Remove due date', on: false }] : []),
            (k) => setFields((f) => ({ ...f, due: k || undefined })))}
        </div>
        <div className="dlg-foot">
          <button type="button" className="switch" role="switch" aria-checked={createMore} aria-label="Create more" onClick={() => store.setView({ createMore: !createMore })} />
          <span>Create more</span>
          <span className="hint">Type <span className="tok-date">fri</span>, <span className="tok-label">#label</span> or <span className="tok-priority">!high</span></span>
          <button type="submit" className="btn primary" disabled={!parsed.title.trim()}>Create task <span style={{ opacity: 0.75 }}>{isMac ? '⌘' : 'Ctrl'}↵</span></button>
        </div>
        {isClosedCategory(status.category) && <p className="faint" style={{ margin: '0 18px 10px' }}>This task will start {status.name.toLowerCase()}.</p>}
      </form>
    </>
  )
}
