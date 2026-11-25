import { ArrowLeft, ChevronDown, ChevronRight, ChevronsRight, ChevronUp, Maximize2, MoreHorizontal, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PRIORITY_NAMES } from '../lib/model/defaults'
import type { Field, HistoryEntry, Task } from '../lib/model/types'
import { childrenOf, identifier, isClosedCategory, projectOf, statusOf, subtaskProgress } from '../lib/model/workspace'
import { isOverdue } from '../lib/query'
import { useApp, type PickerKind } from './context'
import { Archive, ArrowRightLeft, EntityIcon, Layers, MessageSquare, Plus as PlusIcon, PriorityIcon, RotateCcw, Shapes, StatusIcon } from './icons'
import { ago, Due, LabelPill, Markdown, toggleCheckbox } from './ui'

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = '0px'
  el.style.height = `${el.scrollHeight}px`
}

export function TaskDetail({ task, mode, index, total, onClose, onStep, onOpenPage, onOpenTask, backLabel }: {
  task: Task
  mode: 'peek' | 'page'
  index: number
  total: number
  onClose: () => void
  onStep: (delta: 1 | -1) => void
  onOpenPage: () => void
  onOpenTask: (t: Task) => void
  backLabel: string
}) {
  const { state, actions, setUi, store, now } = useApp()
  const ws = state.ws
  const project = projectOf(ws, task)
  const status = statusOf(ws, task.status)
  const parent = task.parent ? ws.tasks.find((t) => t.id === task.parent) : undefined
  const conflict = state.conflicts.find((c) => c.id === task.id)
  const readonly = !!task.archived || state.locked
  const open = (kind: PickerKind) => !readonly && setUi({ picker: { kind, ids: [task.id] } })

  const [title, setTitle] = useState(task.title)
  const [seenTitle, setSeenTitle] = useState(task.title)
  if (task.title !== seenTitle) {
    // Changed by another device or an undo: show it.
    setSeenTitle(task.title)
    setTitle(task.title)
  }
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => autosize(titleRef.current), [title, mode])

  const [editing, setEditing] = useState(false)
  const [desc, setDesc] = useState(task.description)
  const [seenDesc, setSeenDesc] = useState(task.description)
  if (task.description !== seenDesc && !editing) {
    setSeenDesc(task.description)
    setDesc(task.description)
  }
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDesc = (text: string) => {
    if (descTimer.current) clearTimeout(descTimer.current)
    descTimer.current = setTimeout(() => actions.describe(task.id, text), 600)
  }

  const progress = subtaskProgress(ws, task)
  const kids = childrenOf(ws, task)
  const [adding, setAdding] = useState(false)
  const [subTitle, setSubTitle] = useState('')
  const [comment, setComment] = useState('')
  const commentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const focusComment = () => commentRef.current?.focus()
    const focusTitle = () => titleRef.current?.focus()
    window.addEventListener('tasks:focus-comment', focusComment)
    window.addEventListener('tasks:focus-title', focusTitle)
    return () => {
      window.removeEventListener('tasks:focus-comment', focusComment)
      window.removeEventListener('tasks:focus-title', focusTitle)
    }
  }, [])

  const head =
    mode === 'peek' ? (
      <div className="detail-head">
        <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={onClose}><ChevronsRight size={15} /></button>
        <button className="icon-btn" title="Previous (K)" aria-label="Previous task" onClick={() => onStep(-1)}><ChevronUp size={15} /></button>
        <button className="icon-btn" title="Next (J)" aria-label="Next task" onClick={() => onStep(1)}><ChevronDown size={15} /></button>
        {index >= 0 && <span className="pos num" aria-label={`Task ${index + 1} of ${total}`}>{index + 1}<i> / {total}</i></span>}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" title="Open page (⌘↵)" onClick={onOpenPage}><Maximize2 size={14} />Open page</button>
      </div>
    ) : (
      <div className="detail-head">
        <button className="icon-btn" title={`Back to ${backLabel} (Esc)`} aria-label={`Back to ${backLabel}`} onClick={onClose}><ArrowLeft size={15} /></button>
        <nav className="crumb" aria-label="Breadcrumb">
          <EntityIcon name={project?.icon} color={project?.color} size={14} />
          <span>{project?.name ?? 'No project'}</span>
          {parent && (
            <>
              <ChevronRight size={12} className="faint" />
              <button className="num faint" onClick={() => onOpenTask(parent)}>{identifier(ws, parent)}</button>
            </>
          )}
          <ChevronRight size={12} className="faint" />
          <span className="num faint">{identifier(ws, task)}</span>
          <b>{task.title}</b>
        </nav>
        <button className="icon-btn" aria-label="Task actions" onClick={(e) => setUi({ menu: { x: e.clientX, y: e.clientY + 12, ids: [task.id] } })}><MoreHorizontal size={15} /></button>
        <span style={{ flex: 1 }} />
        {index >= 0 && <span className="pos num">{index + 1}<i> / {total}</i></span>}
        <button className="icon-btn" title="Previous (K)" aria-label="Previous task" onClick={() => onStep(-1)}><ChevronUp size={15} /></button>
        <button className="icon-btn" title="Next (J)" aria-label="Next task" onClick={() => onStep(1)}><ChevronDown size={15} /></button>
      </div>
    )

  const strip = (
    <div className="pstrip" role="group" aria-label="Properties">
      <button onClick={() => open('status')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><StatusIcon category={status.category} color={status.color} />{status.name}</button>
      <button onClick={() => open('priority')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><PriorityIcon priority={task.priority} />{PRIORITY_NAMES[task.priority]}</button>
      <button onClick={() => open('labels')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Tag size={13} />{task.labels.length ? task.labels.join(', ') : 'Labels'}</button>
      <button onClick={() => open('due')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{task.due ? <Due due={task.due} overdue={isOverdue(ws, task, now)} now={now} /> : <span className="faint">Due date</span>}</button>
    </div>
  )

  return (
    <div className={`task-detail ${mode}`} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} aria-label="Task details">
      {head}
      <div className="detail-body">
        <div className="scroll">
          <article className="article">
            {task.archived && (
              <div className="banner"><Archive size={14} />This task is archived.<span className="acts"><button className="btn" onClick={() => actions.archive([task.id], false)}><RotateCcw size={13} />Restore</button></span></div>
            )}
            {conflict && (
              <div className="banner" role="alert">
                {conflict.from === 'copy' ? 'The pasted copy has a different title or description for this task.' : 'This task changed elsewhere. Your edits here aren’t saved yet.'}
                <span className="acts">
                  <button className="btn ghost" onClick={() => store.resolveConflict(task.id, false)}>{conflict.from === 'copy' ? 'Use the copy’s' : 'Discard mine'}</button>
                  <button className="btn" onClick={() => store.resolveConflict(task.id, true)}>Keep mine</button>
                </span>
              </div>
            )}
            <div className="inline-meta">
              <span className="num">{identifier(ws, task)}</span>·
              <EntityIcon name={project?.icon} color={project?.color} size={13} />
              {project?.name ?? 'No project'}
              <button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label="Task actions" onClick={(e) => setUi({ menu: { x: e.clientX - 200, y: e.clientY + 12, ids: [task.id] } })}><MoreHorizontal size={15} /></button>
            </div>
            {parent && (
              <div className="inline-meta" style={{ display: 'flex' }}>
                Subtask of
                <button className="label" onClick={() => onOpenTask(parent)}>
                  <StatusIcon category={statusOf(ws, parent.status).category} color={statusOf(ws, parent.status).color} size={12} />
                  <span className="num">{identifier(ws, parent)}</span>
                </button>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{parent.title}</span>
              </div>
            )}
            <textarea
              ref={titleRef}
              className="title-input"
              aria-label="Task title"
              placeholder="Task title"
              rows={1}
              value={title}
              readOnly={readonly}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onBlur={() => actions.rename(task.id, title)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  actions.rename(task.id, title)
                  setEditing(true)
                }
                if (e.key === 'Escape') {
                  setTitle(task.title)
                  ;(e.target as HTMLTextAreaElement).blur()
                }
              }}
            />
            {strip}
            {editing && !readonly ? (
              <textarea
                className="desc-input"
                autoFocus
                aria-label="Description"
                placeholder="Add a description…"
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value)
                  saveDesc(e.target.value)
                }}
                onBlur={() => {
                  if (descTimer.current) clearTimeout(descTimer.current)
                  actions.describe(task.id, desc)
                  setEditing(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key === 's'))) {
                    e.preventDefault()
                    ;(e.target as HTMLTextAreaElement).blur()
                  }
                }}
              />
            ) : task.description ? (
              <div onClick={(e) => !readonly && (e.target as HTMLElement).tagName !== 'A' && (e.target as HTMLElement).tagName !== 'INPUT' && setEditing(true)}>
                <Markdown className="desc" text={task.description} onToggle={readonly ? undefined : (i) => actions.describe(task.id, toggleCheckbox(task.description, i))} />
              </div>
            ) : (
              <div className="desc placeholder" role="button" tabIndex={0} onClick={() => !readonly && setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>Add a description…</div>
            )}

            {!task.parent && (kids.length > 0 || adding ? (
              <section aria-label="Subtasks">
                <div className="sect">
                  Subtasks
                  <span className="pie" style={{ ['--p' as string]: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} aria-hidden />
                  <span className="num">{progress.done}/{progress.total}</span>
                  {!readonly && <button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label="Add subtask" onClick={() => setAdding(true)}><Plus size={14} /></button>}
                </div>
                <div className="subrows">
                  {kids.map((k) => {
                    const ks = statusOf(ws, k.status)
                    return (
                      <div key={k.id} className="subrow">
                        <button aria-label={`Complete ${k.title}`} aria-pressed={ks.category === 'completed'} onClick={() => actions.toggleDone([k.id])} disabled={readonly}>
                          <StatusIcon category={ks.category} color={ks.color} />
                        </button>
                        <span className="num faint">{identifier(ws, k)}</span>
                        <button className="t" style={{ color: isClosedCategory(ks.category) ? 'var(--fg-3)' : undefined }} onClick={() => onOpenTask(k)}>{k.title}</button>
                        <Due due={k.due} overdue={isOverdue(ws, k, now)} now={now} />
                      </div>
                    )
                  })}
                  {adding && (
                    <div className="subrow">
                      <StatusIcon category="unstarted" />
                      <input
                        autoFocus
                        aria-label="Subtask title"
                        placeholder="Subtask title"
                        value={subTitle}
                        onChange={(e) => setSubTitle(e.target.value)}
                        onBlur={() => !subTitle.trim() && setAdding(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && subTitle.trim()) {
                            actions.create({ title: subTitle, parent: task.id })
                            setSubTitle('')
                          }
                          if (e.key === 'Escape') {
                            setSubTitle('')
                            setAdding(false)
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </section>
            ) : (
              !readonly && <button className="btn ghost" style={{ alignSelf: 'flex-start', marginLeft: -8 }} onClick={() => setAdding(true)}><Plus size={14} />Add subtask</button>
            ))}

            <section aria-label="Activity" style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="sect">Activity</div>
              <Timeline task={task} />
              {state.ws.settings.comments && (
                <div className="composer">
                  <textarea
                    ref={commentRef}
                    aria-label="Add comment"
                    placeholder="Leave a comment…"
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value)
                      autosize(e.target)
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && comment.trim()) {
                        actions.comment(task.id, comment)
                        setComment('')
                      }
                      if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
                    }}
                  />
                  <button className="btn" disabled={!comment.trim() || state.locked} title="Send ⌘↵" onClick={() => (actions.comment(task.id, comment), setComment(''))}>Comment</button>
                </div>
              )}
            </section>
          </article>
        </div>
        <Properties task={task} open={open} readonly={readonly} />
      </div>
    </div>
  )
}

function Timeline({ task }: { task: Task }) {
  const { state, actions, now } = useApp()
  const ws = state.ws
  const [editing, setEditing] = useState<number | null>(null)
  const [text, setText] = useState('')
  const byName = (name?: string) => ws.statuses.find((s) => s.name === name)
  const items = task.history.map((h, i) => ({ h, i })).filter(({ h }) => h.kind !== 'comment' || ws.settings.comments)
  if (!items.length) return <p className="faint" style={{ margin: 0 }}>Changes and comments will appear here.</p>
  const line = (h: HistoryEntry) => {
    switch (h.kind) {
      case 'created': return <>Task created</>
      case 'archived': return <>Task archived</>
      case 'restored': return <>Task restored</>
      case 'status': {
        const from = byName(h.from)
        const to = byName(h.to)
        return (
          <>Status changed from {from && <StatusIcon category={from.category} color={from.color} size={12} />} <b>{h.from || 'none'}</b> to {to && <StatusIcon category={to.category} color={to.color} size={12} />} <b>{h.to || 'none'}</b></>
        )
      }
      case 'project': return <>Moved from <b>{h.from || 'no project'}</b> to <b>{h.to || 'no project'}</b></>
      case 'priority': return <>Priority changed to <b>{h.to}</b></>
      case 'due': return h.to ? <>Due date set to <b>{h.to}</b></> : <>Due date removed</>
      case 'labels': return <>Labels changed to <b>{h.to || 'none'}</b></>
      case 'title': return <>Renamed from <b>{h.from}</b></>
      case 'parent': return h.to ? <>Made a subtask of <b>{h.to}</b></> : <>Made a regular task</>
      default: return <>{h.kind} changed to <b>{h.to || 'none'}</b></>
    }
  }
  const badge = (h: HistoryEntry) => {
    if (h.kind === 'status') {
      const to = byName(h.to)
      return to ? <StatusIcon category={to.category} color={to.color} size={12} /> : null
    }
    if (h.kind === 'priority') {
      const p = Object.entries(PRIORITY_NAMES).find(([, n]) => n === h.to)
      return <PriorityIcon priority={(p ? Number(p[0]) : 0) as 0} size={12} />
    }
    if (h.kind === 'comment') return <MessageSquare size={12} />
    if (h.kind === 'project') return <ArrowRightLeft size={12} />
    if (h.kind === 'archived') return <Archive size={12} />
    if (h.kind === 'restored') return <RotateCcw size={12} />
    return <PlusIcon size={12} />
  }
  return (
    <ol className="timeline">
      {items.map(({ h, i }) => (
        <li key={`${h.at}:${i}`}>
          <span className="tl-badge">{badge(h)}</span>
          {h.kind === 'comment' ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b>Comment</b>
                <span className="faint" title={new Date(h.at).toLocaleString()}>· {ago(h.at, now)}</span>
                {h.edited && <span className="faint" title={`Edited ${new Date(h.edited).toLocaleString()}`}>(edited)</span>}
                <span className="comment-acts">
                  <button className="icon-btn" aria-label="Edit comment" onClick={() => (setEditing(i), setText(h.text ?? ''))}><Pencil size={13} /></button>
                  <button className="icon-btn" aria-label="Delete comment" onClick={() => actions.editComment(task.id, i, null)}><Trash2 size={13} /></button>
                </span>
              </div>
              {editing === i ? (
                <div className="composer" style={{ marginTop: 4 }}>
                  <textarea autoFocus value={text} aria-label="Edit comment" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      actions.editComment(task.id, i, text)
                      setEditing(null)
                    }
                    if (e.key === 'Escape') setEditing(null)
                  }} />
                  <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                    <button className="btn" onClick={() => (actions.editComment(task.id, i, text), setEditing(null))}>Save</button>
                  </span>
                </div>
              ) : (
                <Markdown className="comment-body" text={h.text ?? ''} />
              )}
            </div>
          ) : (
            <span>{line(h)} <span className="faint" title={new Date(h.at).toLocaleString()}>· {ago(h.at, now)}</span></span>
          )}
        </li>
      ))}
    </ol>
  )
}

function FieldValue({ field, value, onChange, readonly }: { field: Field; value: string; onChange: (v: string) => void; readonly: boolean }) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  const commit = () => draft !== value && onChange(draft)
  const style = { width: '100%', border: '1px solid var(--line)', borderRadius: 5, background: 'var(--bg)', padding: '3px 6px' }
  if (field.type === 'checkbox')
    return <input type="checkbox" disabled={readonly} checked={value === 'true' || value === 'yes'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} aria-label={field.name} />
  if (field.type === 'select')
    return (
      <select disabled={readonly} value={value} onChange={(e) => onChange(e.target.value)} aria-label={field.name} style={style}>
        <option value="">—</option>
        {field.options.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
      </select>
    )
  if (field.type === 'textarea' || field.type === 'media' || field.type === 'multiselect')
    return <textarea readOnly={readonly} value={draft} rows={2} aria-label={field.name} placeholder={field.type === 'multiselect' ? field.options.map((o) => o.value).join(', ') : ''} onChange={(e) => setDraft(e.target.value)} onBlur={commit} style={{ ...style, resize: 'vertical' }} />
  return (
    <input
      readOnly={readonly}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={draft}
      aria-label={field.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      style={style}
    />
  )
}

function Properties({ task, open, readonly }: { task: Task; open: (k: PickerKind) => void; readonly: boolean }) {
  const { state, actions, now } = useApp()
  const ws = state.ws
  const status = statusOf(ws, task.status)
  const project = projectOf(ws, task)
  const type = ws.types.find((t) => t.id === task.type)
  const bucket = ws.buckets.find((b) => b.id === task.bucket)
  const row = (k: string, v: React.ReactNode, kind?: PickerKind, title?: string) => (
    <div className="prop">
      <span className="k">{k}</span>
      {kind ? <button className="v" disabled={readonly} title={title} onClick={() => open(kind)}>{v}</button> : <span className="v">{v}</span>}
    </div>
  )
  return (
    <aside className="props" aria-label="Properties">
      <div className="sect" style={{ marginBottom: 8 }}>Properties</div>
      <div className="pcard">
        {row('Status', <><StatusIcon category={status.category} color={status.color} />{status.name}</>, 'status')}
        {row('Priority', <><PriorityIcon priority={task.priority} />{PRIORITY_NAMES[task.priority]}</>, 'priority')}
        {row('Due date', task.due ? <Due due={task.due} overdue={isOverdue(ws, task, now)} now={now} /> : <span className="faint">No due date</span>, 'due')}
        <div className="psep" />
        {row('Labels', task.labels.length ? <>{task.labels.map((l) => <LabelPill key={l} ws={ws} name={l} />)}<Plus size={13} className="faint" /></> : <><Tag size={13} className="faint" /><span className="faint">Add label</span></>, 'labels')}
        {(ws.types.length > 0 || type) && row('Type', type ? <><Shapes size={14} style={{ color: type.color }} />{type.name}</> : <span className="faint">No type</span>, 'type')}
        {(ws.buckets.length > 0 || bucket) && row('Bucket', bucket ? <><Layers size={14} style={{ color: bucket.color }} />{bucket.name}</> : <span className="faint">No bucket</span>, 'bucket')}
        <div className="psep" />
        {row('Project', <><EntityIcon name={project?.icon} color={project?.color} size={14} />{project?.name ?? 'No project'}</>, task.parent ? undefined : 'project', task.parent ? 'Inherited from parent' : undefined)}
        {ws.cycleSettings.enabled && row('Cycle', task.cycle ? `Cycle ${task.cycle}` : <span className="faint">No cycle</span>, 'cycle')}
        {ws.fields.length > 0 && <div className="psep" />}
        {ws.fields.map((f) => (
          <div className="prop" key={f.id}>
            <span className="k" title={f.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
            <span style={{ flex: 1, minWidth: 0 }}><FieldValue field={f} value={task.fields[f.id] ?? ''} readonly={readonly} onChange={(v) => actions.setCustomField(task.id, f.id, v)} /></span>
          </div>
        ))}
      </div>
      <div className="details">
        <div>Created {new Date(task.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
        {task.updated !== task.created && <div>Updated {ago(task.updated, now)}</div>}
        {task.completed && <div>Completed {new Date(task.completed).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>}
        {task.cancelled && <div>Cancelled {new Date(task.cancelled).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>}
      </div>
    </aside>
  )
}
