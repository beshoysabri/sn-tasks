import { Columns3, List, Search, SlidersHorizontal, Table2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { KEY_HINTS, KEYS, suggestValues } from '../lib/query'
import type { DisplayOptions, GroupBy } from '../lib/store'
import { useApp } from './context'
import { useDismiss } from './ui'

const TOKEN = /(-?[\w-]+:"[^"]*"|"[^"]*"|\S+)/g
const CHIP = /^(-?)([a-zA-Z_][\w-]*):(.+)$/

function split(query: string, fieldKeys: string[]) {
  const tokens = query.match(TOKEN) ?? []
  const endsWithSpace = /\s$/.test(query)
  const chips: string[] = []
  const rest: string[] = []
  tokens.forEach((tok, i) => {
    const last = i === tokens.length - 1 && !endsWithSpace
    const m = CHIP.exec(tok)
    const known = m && ((KEYS as readonly string[]).includes(m[2].toLowerCase()) || ['state', 'tag', 'tags', 'labels', 'p', 'area', 'spaces'].includes(m[2].toLowerCase()) || fieldKeys.includes(m[2].toLowerCase()))
    if (known && !last && rest.length === 0) chips.push(tok)
    else rest.push(tok)
  })
  return { chips, text: rest.join(' ') + (endsWithSpace && rest.length ? ' ' : '') }
}

export function FilterBar({ value, onChange, placeholderCount }: { value: string; onChange: (q: string) => void; placeholderCount?: number }) {
  const { state } = useApp()
  const ws = state.ws
  const fieldKeys = ws.fields.map((f) => f.name.trim().toLowerCase().replace(/\s+/g, '-'))
  const { chips, text } = split(value, fieldKeys)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const join = (c: string[], t: string) => [...c, t].filter((x, i, a) => x || i === a.length - 1).join(' ').replace(/^\s+/, '')

  const word = /(\S*)$/.exec(text)?.[1] ?? ''
  const suggestions = (() => {
    if (!focused) return []
    const m = /^(-?)([a-zA-Z_][\w-]*):([^\s]*)$/.exec(word)
    if (m) {
      const typed = m[3].split(',').pop()!.toLowerCase()
      return suggestValues(ws, m[2].toLowerCase())
        .filter((v) => v.value.toLowerCase().startsWith(typed) || v.label.toLowerCase().startsWith(typed))
        .slice(0, 8)
        .map((v) => ({ kind: 'value' as const, value: v.value, label: v.label, hint: '' }))
    }
    const typed = word.replace(/^-/, '').toLowerCase()
    return [...KEYS, ...fieldKeys]
      .filter((k) => k.startsWith(typed))
      .map((k) => ({ kind: 'key' as const, value: k, label: `${k}:`, hint: (KEY_HINTS as Record<string, string>)[k] ?? 'Custom field' }))
  })()

  const accept = (i: number) => {
    const s = suggestions[i]
    if (!s) return
    const head = text.slice(0, text.length - word.length)
    if (s.kind === 'key') onChange(join(chips, `${head}${word.startsWith('-') ? '-' : ''}${s.value}:`))
    else {
      const m = /^(-?[a-zA-Z_][\w-]*:)(.*)$/.exec(word)!
      const values = m[2].split(',')
      values[values.length - 1] = /\s/.test(s.value) ? `"${s.value}"` : s.value
      onChange(join(chips, `${head}${m[1]}${values.join(',')} `))
    }
    setActive(0)
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }} ref={box}>
      <div className="searchbox" onClick={() => input.current?.focus()}>
        <Search size={14} className="faint" aria-hidden />
        {chips.map((chip, i) => {
          const m = CHIP.exec(chip)!
          return (
            <span key={`${chip}:${i}`} className="fchip">
              <button className="k" title={m[1] ? 'Include matches' : 'Exclude matches'} onClick={() => onChange(join(chips.map((c, j) => (j === i ? (m[1] ? c.slice(1) : `-${c}`) : c)), text))}>
                {m[2]}
                {m[1] && <span className="not">not</span>}
              </button>
              <span className="v">{m[3].replace(/"/g, '')}</span>
              <button className="x" aria-label={`Remove ${chip}`} onClick={() => onChange(join(chips.filter((_, j) => j !== i), text))}><X size={11} /></button>
            </span>
          )
        })}
        <input
          ref={input}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-label="Search tasks"
          placeholder={chips.length ? '' : 'Search or filter…  try status:todo priority:urgent label:ui'}
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onChange={(e) => {
            onChange(join(chips, e.target.value))
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length) {
              e.preventDefault()
              setActive((a) => (a + 1) % suggestions.length)
            } else if (e.key === 'ArrowUp' && suggestions.length) {
              e.preventDefault()
              setActive((a) => (a + suggestions.length - 1) % suggestions.length)
            } else if ((e.key === 'Tab' || e.key === 'Enter') && suggestions.length && word) {
              e.preventDefault()
              accept(active)
            }
            else if (e.key === 'Backspace' && !text && chips.length) {
              e.preventDefault()
              onChange(join(chips.slice(0, -1), chips[chips.length - 1]))
            } else if (e.key === 'Escape') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
              window.dispatchEvent(new Event('tasks:focus-list'))
            }
          }}
        />
        {value ? (
          <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Clear search" onClick={() => onChange('')}><X size={13} /></button>
        ) : (
          !focused && <kbd>/</kbd>
        )}
        {value && placeholderCount !== undefined && <span className="faint num" style={{ fontSize: 12 }}>{placeholderCount}</span>}
      </div>
      {suggestions.length > 0 && (
        <div className="menu" role="listbox" aria-label="Search suggestions" style={{ position: 'absolute', top: 38, left: 0, width: 340 }}>
          {suggestions.map((s, i) => (
            <button key={s.kind + s.value} className="mi sug" data-active={i === active} onMouseDown={(e) => (e.preventDefault(), accept(i))} onMouseMove={() => setActive(i)}>
              <span className="mono">{s.label}</span>
              <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.hint}</span>
            </button>
          ))}
          <div className="sugfoot"><span>↑↓ choose</span><span>⇥ complete</span><span>-key: exclude</span><span>a,b either</span></div>
        </div>
      )}
    </div>
  )
}

const DIRECTIONS: Record<string, [string, string]> = {
  status: ['Settings order', 'Reverse order'],
  type: ['Settings order', 'Reverse order'],
  priority: ['Highest first', 'Lowest first'],
  due: ['Soonest first', 'Latest first'],
  created: ['Oldest first', 'Newest first'],
  updated: ['Oldest first', 'Newest first'],
}

export function DisplayMenu({ options, onChange, allowProject }: { options: DisplayOptions; onChange: (patch: Partial<DisplayOptions>) => void; allowProject: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, () => setOpen(false), open)
  const { state } = useApp()
  const groupings: [GroupBy, string][] = [
    ['status', 'Status'], ['priority', 'Priority'], ...(state.ws.types.length ? [['type', 'Type'] as [GroupBy, string]] : []),
    ...(state.ws.buckets.length ? [['bucket', 'Bucket'] as [GroupBy, string]] : []), ['due', 'Due date'],
    ...(allowProject ? [['project', 'Project'] as [GroupBy, string]] : []), ['none', 'No grouping'],
  ]
  const select = (label: string, value: string, items: [string, string][], set: (v: string) => void) => (
    <>
      <span className="muted">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)} style={{ height: 30, borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-2)', padding: '0 6px' }}>
        {items.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
      </select>
    </>
  )
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="square" aria-label="Display options" title="Display" aria-expanded={open} onClick={() => setOpen(!open)}><SlidersHorizontal size={15} /></button>
      {open && (
        <div className="menu" style={{ position: 'absolute', right: 0, top: 38, width: 290, padding: 12 }}>
          <div role="radiogroup" aria-label="Task layout" style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-3)', borderRadius: 8, marginBottom: 12 }}>
            {([['list', 'List', List], ['board', 'Board', Columns3], ['table', 'Table', Table2]] as const).map(([v, n, Icon]) => (
              <button key={v} role="radio" aria-checked={options.layout === v} onClick={() => onChange({ layout: v })} style={{ flex: 1, height: 28, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: options.layout === v ? 'var(--bg)' : 'transparent', color: options.layout === v ? 'var(--fg)' : 'var(--fg-3)', fontWeight: 500 }}>
                <Icon size={14} />{n}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px 12px', alignItems: 'center' }}>
            {options.layout !== 'board' && select('Grouping', options.groupBy, groupings, (v) => onChange({ groupBy: v as GroupBy }))}
            {options.layout === 'board' && select('Columns', options.columns, [['status', 'Status'], ...(state.ws.buckets.length ? [['bucket', 'Bucket'] as [string, string]] : [])], (v) => onChange({ columns: v as 'status' | 'bucket' }))}
            {options.layout === 'board' && select('Lanes', options.wrap ? 'wrap' : 'scroll', [['scroll', 'Scroll sideways'], ['wrap', 'Wrap onto rows']], (v) => onChange({ wrap: v === 'wrap' }))}
            {select('Ordering', options.ordering, [['manual', 'Manual'], ['status', 'Status'], ['priority', 'Priority'], ...(state.ws.types.length ? [['type', 'Type'] as [string, string]] : []), ['due', 'Due date'], ['created', 'Created'], ['updated', 'Updated']], (v) =>
              onChange({ ordering: v as DisplayOptions['ordering'], direction: v === 'created' || v === 'updated' ? 'desc' : 'asc' }))}
            {options.ordering !== 'manual' && select('Direction', options.direction, [['asc', DIRECTIONS[options.ordering][0]], ['desc', DIRECTIONS[options.ordering][1]]], (v) => onChange({ direction: v as 'asc' | 'desc' }))}
          </div>
          {options.ordering !== 'manual' && <p style={{ margin: '12px 0 0', color: 'var(--fg-4)', fontSize: 12, lineHeight: 1.5 }}>Dragging on the board still changes {options.columns}. Reordering needs manual ordering.</p>}
        </div>
      )}
    </div>
  )
}
