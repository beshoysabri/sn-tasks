import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, CATEGORY_NAMES, PALETTE, PRIORITY_NAMES } from '../lib/model/defaults'
import type { FieldType, Priority, StatusCategory, Workspace } from '../lib/model/types'
import { allLabels, labelColour, today, WEEKDAYS } from '../lib/model/workspace'
import { ensureCycles } from '../lib/cycles'
import { download, fileName, toCsv, toJson, toMarkdown } from '../lib/export'
import * as s from '../lib/settingsOps'
import { useApp } from './context'
import { Layers, Shapes, StatusIcon } from './icons'
import { useDismiss } from './ui'

const PAGES = [
  ['general', 'General'],
  ['statuses', 'Statuses'],
  ['labels', 'Labels'],
  ['types', 'Types'],
  ['buckets', 'Buckets'],
  ['fields', 'Custom fields'],
  ['cycles', 'Cycles'],
] as const

function Swatch({ color, onPick, label, children }: { color?: string; onPick: (c: string | null) => void; label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useDismiss(ref, () => setOpen(false), open)
  return (
    <span ref={ref} style={{ position: 'relative' }}>
      <button aria-label={label} title={label} onClick={() => setOpen(!open)} style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 6 }}>
        {children ?? <i className="dot" style={{ width: 12, height: 12, background: color ?? 'var(--fg-4)' }} />}
      </button>
      {open && (
        <div className="menu" style={{ position: 'absolute', top: 26, left: 0, width: 214, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, padding: 10 }}>
          {PALETTE.map((p) => (
            <button key={p.hex} aria-label={p.name} title={p.name} onClick={() => (onPick(p.hex), setOpen(false))} style={{ width: 24, height: 24, borderRadius: '50%', background: p.hex, outline: color?.toLowerCase() === p.hex.toLowerCase() ? '2px solid var(--fg)' : undefined, outlineOffset: 2 }} />
          ))}
          <button onClick={() => (onPick(null), setOpen(false))} style={{ gridColumn: 'span 6', fontSize: 12, color: 'var(--fg-3)', textAlign: 'left' }}>Reset colour</button>
        </div>
      )}
    </span>
  )
}

function NameInput({ value, onCommit, readOnly, label }: { value: string; onCommit: (v: string) => void; readOnly?: boolean; label: string }) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  return (
    <input
      aria-label={label}
      value={draft}
      readOnly={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft.trim() && draft !== value ? onCommit(draft) : setDraft(value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', height: 28 }}
    />
  )
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="prop" style={{ padding: '0 8px' }}>
      <Plus size={14} className="faint" />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onAdd(name)
            setName('')
          }
        }}
        style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', height: 28 }}
      />
    </div>
  )
}

const card = { border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-2)', padding: '4px 0', marginBottom: 20 } as const
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '0 8px' } as const

export function WorkspaceSettings({ page, onPage }: { page: string; onPage: (p: string) => void }) {
  const { state, store, setUi } = useApp()
  const ws = state.ws
  const locked = state.locked
  const apply = (label: string, op: Parameters<typeof store.apply>[1]) => store.apply(label, op)
  const confirm = (title: string, body: string, confirmLabel: string, run: () => void) => setUi({ confirm: { title, body, confirm: confirmLabel, danger: true, run } })
  const count = (pred: (t: (typeof ws.tasks)[number]) => boolean) => ws.tasks.filter(pred).length
  const mover = (index: number, length: number, move: (delta: -1 | 1) => void) => (
    <>
      <button className="icon-btn" aria-label="Move up" disabled={index === 0 || locked} onClick={() => move(-1)}><ArrowUp size={13} /></button>
      <button className="icon-btn" aria-label="Move down" disabled={index === length - 1 || locked} onClick={() => move(1)}><ArrowDown size={13} /></button>
    </>
  )

  const content = () => {
    switch (page) {
      case 'statuses':
        return (
          <>
            <p className="muted">A status’s category sets its icon and whether its tasks count as open, completed or cancelled. Projects can limit which statuses they use in their settings.</p>
            {CATEGORIES.map((c: StatusCategory) => {
              const list = ws.statuses.filter((x) => x.category === c)
              return (
                <section key={c}>
                  <h3 className="sect" style={{ margin: '14px 0 6px' }}>{CATEGORY_NAMES[c]}</h3>
                  <div style={card}>
                    {list.map((st) => (
                      <div key={st.id} style={rowStyle}>
                        <Swatch color={st.color} label="Change status colour" onPick={(color) => apply('Status colour', (d) => s.updateStatus(d, st.id, { color }))}>
                          <StatusIcon category={st.category} color={st.color} />
                        </Swatch>
                        <NameInput label="Status name" value={st.name} readOnly={st.builtin || locked} onCommit={(name) => apply('Renamed status', (d) => s.updateStatus(d, st.id, { name }))} />
                        {st.builtin ? (
                          <span title="Built-in statuses can’t be renamed or deleted" className="faint"><Lock size={13} /></span>
                        ) : (
                          <button className="icon-btn" aria-label={`Delete ${st.name}`} disabled={locked} onClick={() => confirm(`Delete “${st.name}”?`, `${count((t) => t.status === st.id) || 'No'} task(s) move to “${ws.statuses.find((x) => x.builtin && x.category === c)?.name}”, or the nearest status their project uses.`, 'Delete status', () => apply('Deleted status', (d) => s.deleteStatus(d, st.id)))}><Trash2 size={13} /></button>
                        )}
                      </div>
                    ))}
                    {!locked && <AddRow placeholder={`New ${CATEGORY_NAMES[c].toLowerCase()} status`} onAdd={(name) => apply('Added status', (d) => void s.addStatus(d, name, c))} />}
                  </div>
                </section>
              )
            })}
          </>
        )
      case 'labels': {
        const names = allLabels(ws)
        return (
          <>
            <p className="muted">Renaming or deleting a label updates every task that has it.</p>
            <div style={card}>
              {names.map((name) => (
                <div key={name} style={rowStyle}>
                  <Swatch color={labelColour(ws, name)} label="Change label colour" onPick={(color) => apply('Label colour', (d) => s.updateLabel(d, name, { color }))} />
                  <NameInput label="Label name" value={name} readOnly={locked} onCommit={(to) => apply('Renamed label', (d) => s.updateLabel(d, name, { name: to }))} />
                  <span className="faint num" style={{ fontSize: 12 }}>{count((t) => t.labels.some((l) => l.toLowerCase() === name.toLowerCase())) || ''}</span>
                  <button className="icon-btn" aria-label={`Delete ${name}`} disabled={locked} onClick={() => confirm(`Delete “${name}”?`, `It comes off ${count((t) => t.labels.some((l) => l.toLowerCase() === name.toLowerCase()))} task(s).`, 'Delete label', () => apply('Deleted label', (d) => s.deleteLabel(d, name)))}><Trash2 size={13} /></button>
                </div>
              ))}
              {!names.length && <div style={{ ...rowStyle, color: 'var(--fg-4)' }}>No labels yet</div>}
              {!locked && <AddRow placeholder="New label" onAdd={(name) => apply('Added label', (d) => void s.addLabel(d, name, PALETTE[(names.length * 5) % PALETTE.length].hex))} />}
            </div>
          </>
        )
      }
      case 'types':
        return (
          <>
            <p className="muted">What kind of work a task is, like Bug or Feature. Giving a task a type adds the type’s labels and sets its priority if it has none.</p>
            <div style={card}>
              {ws.types.map((ty, i) => (
                <div key={ty.id} style={{ ...rowStyle, flexWrap: 'wrap' }}>
                  <Swatch color={ty.color} label="Change type colour" onPick={(color) => apply('Type colour', (d) => s.updateType(d, ty.id, { color: color ?? undefined }))}><Shapes size={14} style={{ color: ty.color }} /></Swatch>
                  <NameInput label="Type name" value={ty.name} readOnly={locked} onCommit={(name) => apply('Renamed type', (d) => s.updateType(d, ty.id, { name }))} />
                  <input aria-label={`Labels ${ty.name} adds`} placeholder="Add labels" defaultValue={ty.labels.join(', ')} readOnly={locked} onBlur={(e) => apply('Type labels', (d) => s.updateType(d, ty.id, { labels: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))} style={{ width: 120, border: '1px solid var(--line)', borderRadius: 5, background: 'var(--bg)', height: 26, padding: '0 6px' }} />
                  <select aria-label={`Priority ${ty.name} sets`} value={ty.priority} disabled={locked} onChange={(e) => apply('Type priority', (d) => s.updateType(d, ty.id, { priority: Number(e.target.value) as Priority }))} style={{ height: 26, borderRadius: 5, border: '1px solid var(--line)', background: 'var(--bg)' }}>
                    <option value={0}>Leave priority</option>
                    {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORITY_NAMES[p as Priority]}</option>)}
                  </select>
                  {mover(i, ws.types.length, (delta) => apply('Moved type', (d) => d.set('types', s.moveItem(d.ws.types, i, delta))))}
                  <button className="icon-btn" aria-label={`Delete ${ty.name}`} disabled={locked} onClick={() => confirm(`Delete “${ty.name}”?`, `${count((t) => t.type === ty.id)} task(s) lose their type. Labels and priorities its rules set stay.`, 'Delete type', () => apply('Deleted type', (d) => s.deleteType(d, ty.id)))}><Trash2 size={13} /></button>
                </div>
              ))}
              {!locked && <AddRow placeholder="New type" onAdd={(name) => apply('Added type', (d) => void s.addType(d, name, PALETTE[(ws.types.length * 7 + 3) % PALETTE.length].hex))} />}
            </div>
          </>
        )
      case 'buckets':
        return (
          <>
            <p className="muted">Lanes you sort tasks into by hand, like Now, Next or Later. Group the list or the board by bucket to work from them.</p>
            <div style={card}>
              {ws.buckets.map((b, i) => (
                <div key={b.id} style={rowStyle}>
                  <Swatch color={b.color} label="Change bucket colour" onPick={(color) => apply('Bucket colour', (d) => s.updateBucket(d, b.id, { color }))}><Layers size={14} style={{ color: b.color }} /></Swatch>
                  <NameInput label="Bucket name" value={b.name} readOnly={locked} onCommit={(name) => apply('Renamed bucket', (d) => s.updateBucket(d, b.id, { name }))} />
                  {mover(i, ws.buckets.length, (delta) => apply('Moved bucket', (d) => d.set('buckets', s.moveItem(d.ws.buckets, i, delta))))}
                  <button className="icon-btn" aria-label={`Delete ${b.name}`} disabled={locked} onClick={() => confirm(`Delete “${b.name}”?`, `${count((t) => t.bucket === b.id)} task(s) move to No bucket.`, 'Delete bucket', () => apply('Deleted bucket', (d) => s.deleteBucket(d, b.id)))}><Trash2 size={13} /></button>
                </div>
              ))}
              {!locked && <AddRow placeholder="New bucket" onAdd={(name) => apply('Added bucket', (d) => void s.addBucket(d, name))} />}
            </div>
          </>
        )
      case 'fields':
        return <FieldsPage />
      case 'cycles':
        return (
          <>
            <p className="muted">Plan work in repeating time boxes. Turning cycles on starts a numbered active cycle and an upcoming one; tasks are not added automatically.</p>
            <div style={card}>
              <label style={rowStyle}>
                <input type="checkbox" checked={ws.cycleSettings.enabled} disabled={locked} onChange={(e) => apply(e.target.checked ? 'Cycles on' : 'Cycles off', (d) => {
                  d.set('cycleSettings', { ...d.ws.cycleSettings, enabled: e.target.checked })
                  ensureCycles(d)
                })} />
                Use cycles
              </label>
              <label style={rowStyle}>
                <span style={{ width: 110 }} className="muted">Cycle length</span>
                <select value={ws.cycleSettings.weeks} disabled={locked} onChange={(e) => apply('Cycle length', (d) => d.set('cycleSettings', { ...d.ws.cycleSettings, weeks: Number(e.target.value) }))}>
                  {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>)}
                </select>
              </label>
              <label style={rowStyle}>
                <span style={{ width: 110 }} className="muted">Starts on</span>
                <select value={ws.cycleSettings.startDay} disabled={locked} onChange={(e) => apply('Cycle start', (d) => d.set('cycleSettings', { ...d.ws.cycleSettings, startDay: Number(e.target.value) }))}>
                  {WEEKDAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </label>
            </div>
          </>
        )
      default:
        return <GeneralPage />
    }
  }

  return (
    <div className="scroll">
      <div style={{ display: 'flex', gap: 24, padding: '20px 28px 48px', maxWidth: 900, flexWrap: 'wrap' }}>
        <nav aria-label="Settings" style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 160 }}>
          {PAGES.map(([id, name]) => (
            <button key={id} className="sb-item" aria-current={page === id ? 'page' : undefined} onClick={() => onPage(id)}>{name}</button>
          ))}
        </nav>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ margin: '4px 0 8px', fontSize: 16 }}>{PAGES.find(([id]) => id === page)?.[1] ?? 'General'}</h2>
          {content()}
        </div>
      </div>
    </div>
  )
}

function GeneralPage() {
  const { state, store } = useApp()
  const ws = state.ws
  const [key, setKey] = useState(ws.settings.noProjectKey)
  return (
    <>
      <div style={card}>
        <div style={{ ...rowStyle, flexWrap: 'wrap', padding: '8px' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div>Task IDs without a project</div>
            <div className="faint" style={{ fontSize: 12.5 }}>Each project numbers its tasks under its own key, like WEB-1. Tasks without a project use this one: {ws.settings.noProjectKey}-1, {ws.settings.noProjectKey}-2…</div>
          </div>
          <input aria-label="Key for tasks without a project" value={key} readOnly={state.locked} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} onBlur={() => store.apply('Changed key', (d) => s.setNoProjectKey(d, key))} style={{ width: 90, fontFamily: 'var(--mono)', height: 30, border: '1px solid var(--line-2)', borderRadius: 6, padding: '0 8px', background: 'var(--bg)' }} />
        </div>
        <div style={{ ...rowStyle, flexWrap: 'wrap', padding: '8px' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div>Week starts on</div>
            <div className="faint" style={{ fontSize: 12.5 }}>Sets “This week” for due dates and the Due this week filter, “Next week” when picking a date, and the weekly bars in a project’s activity.</div>
          </div>
          <select aria-label="Week starts on" className="btn" value={ws.settings.weekStart} disabled={state.locked} onChange={(e) => store.apply('Week start', (d) => d.set('settings', { ...d.ws.settings, weekStart: Number(e.target.value) }))}>
            {[...new Set([5, 6, 0, ws.settings.weekStart])].map((day) => <option key={day} value={day}>{WEEKDAYS[day]}</option>)}
          </select>
        </div>
        <label style={{ ...rowStyle, padding: '8px' }}>
          <input type="checkbox" checked={ws.settings.comments} disabled={state.locked} onChange={(e) => store.apply('Comments', (d) => d.set('settings', { ...d.ws.settings, comments: e.target.checked }))} />
          <span>Comments <span className="faint" style={{ fontSize: 12.5 }}>— turning this off hides existing comments without deleting them.</span></span>
        </label>
      </div>
      <h3 className="sect" style={{ margin: '0 0 6px' }}>Export</h3>
      <div style={card}>
        {store.canDownload() ? (
          <div style={{ display: 'grid', gap: 8, padding: 8 }}>
            <span className="faint" style={{ fontSize: 12.5 }}>Every task, archived ones too. CSV opens in a spreadsheet; Markdown is the note as it is saved; JSON holds everything.</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {EXPORTS.map(([label, ext, type, make]) => (
                <button key={ext} className="btn" onClick={() => download(make(ws), fileName(state.title || 'Tasks', ext, today()), type)}>{label}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="faint" style={{ fontSize: 12.5, padding: 8 }}>Export works in the Standard Notes desktop and web apps; the phone app can’t save files from an editor.</div>
        )}
      </div>
    </>
  )
}

const EXPORTS: [string, string, string, (ws: Workspace) => string][] = [
  ['CSV', 'csv', 'text/csv', toCsv],
  ['Markdown', 'md', 'text/markdown', toMarkdown],
  ['JSON', 'json', 'application/json', (ws) => toJson(ws)],
]

const FIELD_TYPES: [FieldType, string][] = [['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Select'], ['multiselect', 'Multi-select'], ['url', 'URL'], ['media', 'Links (one per line)'], ['checkbox', 'Checkbox']]

function FieldsPage() {
  const { state, store, setUi } = useApp()
  const ws = state.ws
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const problem = name ? s.fieldNameProblem(name, ws.fields) : null
  return (
    <>
      <p className="muted">Extra properties for every task, shown under the built-in ones, in the Table and in filters (effort:l).</p>
      <div style={card}>
        {ws.fields.map((f, i) => (
          <div key={f.id} style={{ ...rowStyle, flexWrap: 'wrap', padding: '4px 8px' }}>
            <NameInput label="Field name" value={f.name} readOnly={state.locked} onCommit={(n) => store.apply('Renamed field', (d) => s.updateField(d, f.id, { name: n }))} />
            <span className="faint" style={{ fontSize: 12 }}>{FIELD_TYPES.find(([t]) => t === f.type)?.[1]}</span>
            {(f.type === 'select' || f.type === 'multiselect') && (
              <input aria-label={`Options of ${f.name}`} placeholder="Options, comma-separated" defaultValue={f.options.map((o) => o.value).join(', ')} readOnly={state.locked}
                onBlur={(e) => store.apply('Field options', (d) => s.updateField(d, f.id, { options: e.target.value.split(',').map((v) => v.trim()).filter(Boolean).map((value) => ({ value, color: f.options.find((o) => o.value === value)?.color })) }))}
                style={{ flex: '1 1 160px', border: '1px solid var(--line)', borderRadius: 5, background: 'var(--bg)', height: 26, padding: '0 6px' }} />
            )}
            <button className="icon-btn" aria-label="Move up" disabled={i === 0 || state.locked} onClick={() => store.apply('Moved field', (d) => d.set('fields', s.moveItem(d.ws.fields, i, -1)))}><ArrowUp size={13} /></button>
            <button className="icon-btn" aria-label={`Delete ${f.name}`} disabled={state.locked} onClick={() => setUi({ confirm: { title: `Delete “${f.name}”?`, body: 'The field and its value on every task will be removed.', confirm: 'Delete field', danger: true, run: () => store.apply('Deleted field', (d) => s.deleteField(d, f.id)) } })}><Trash2 size={13} /></button>
          </div>
        ))}
        {!ws.fields.length && <div style={{ ...rowStyle, color: 'var(--fg-4)' }}>No custom fields yet</div>}
        {!state.locked && (
          <form style={{ ...rowStyle, padding: '6px 8px' }} onSubmit={(e) => {
            e.preventDefault()
            if (!problem && name.trim()) {
              store.apply('Added field', (d) => void s.addField(d, { name, type, options: [] }))
              setName('')
            }
          }}>
            <Plus size={14} className="faint" />
            <input aria-label="New field" placeholder="New field" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', height: 28 }} />
            <select aria-label="Field type" value={type} onChange={(e) => setType(e.target.value as FieldType)} style={{ height: 26 }}>
              {FIELD_TYPES.map(([t, n]) => <option key={t} value={t}>{n}</option>)}
            </select>
            <button className="btn" type="submit" disabled={!!problem || !name.trim()}>Add</button>
          </form>
        )}
        {problem && <div style={{ ...rowStyle, color: 'var(--attention)', fontSize: 12.5 }}>{problem}</div>}
      </div>
    </>
  )
}
