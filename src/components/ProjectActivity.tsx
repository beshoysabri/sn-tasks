import { ExternalLink, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Project, StatusCategory } from '../lib/model/types'
import { identifier, labelColour, nextWeekStart, statusOf } from '../lib/model/workspace'
import * as ops from '../lib/ops'
import { useApp } from './context'
import { StatusIcon } from './icons'
import { ago } from './ui'

type Kind = 'created' | 'comment' | StatusCategory
const KINDS: { key: Kind; name: string; color: string }[] = [
  { key: 'created', name: 'Created', color: 'color-mix(in srgb, var(--fg) 30%, var(--bg))' },
  { key: 'started', name: 'In progress', color: 'var(--started)' },
  { key: 'review', name: 'In review', color: 'var(--review)' },
  { key: 'completed', name: 'Done', color: 'var(--done)' },
  { key: 'comment', name: 'Comments', color: 'color-mix(in srgb, var(--accent) 45%, var(--bg))' },
]
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']] as const
type Days = (typeof RANGES)[number][0]
const DAY = 86_400_000
const NO_LABEL = '\u0000none'
const OTHER = '\u0000other'
const TOP_LABELS = 5

/** Changes over time across a project's tasks, stacked by what they were or by label (Octarine's Activity card). */
export function ProjectActivity({ project, now }: { project: Project; now: number }) {
  const { state } = useApp()
  const ws = state.ws
  const [days, setDays] = useState<Days>(30)
  const [by, setBy] = useState<'status' | 'label'>('status')
  const { buckets, series, total, touched, recent, step } = useMemo(() => {
    // A year is drawn a week per bar (weeks start on the workspace's day), shorter ranges a day per bar;
    // the last bar holds today.
    const step = days > 120 ? 7 : 1
    const end = step === 7 ? nextWeekStart(new Date(now), ws.settings.weekStart) : new Date(now)
    if (step === 1) {
      end.setHours(0, 0, 0, 0)
      end.setDate(end.getDate() + 1)
    }
    const count = Math.ceil(days / step)
    const start = new Date(end)
    start.setDate(start.getDate() - count * step)
    const buckets = Array.from({ length: count }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i * step)
      return { day: d, counts: {} as Record<string, number> }
    })
    const events: { i: number; kind: Kind; label: string }[] = []
    const touchedSet = new Set<string>()
    const recent: { id: string; at: string; what: string[] }[] = []
    for (const t of ws.tasks.filter((x) => x.project === project.id)) {
      for (const h of t.history) {
        const kind: Kind | null = h.kind === 'created' ? 'created' : h.kind === 'comment' ? 'comment' : h.kind === 'status' ? (ws.statuses.find((s) => s.name === h.to)?.category ?? null) : null
        if (!kind || !KINDS.some((k) => k.key === kind)) continue
        const at = new Date(h.at).getTime()
        if (at < start.getTime() || at >= end.getTime()) continue
        const i = Math.min(count - 1, Math.floor((at - start.getTime()) / (step * DAY)))
        events.push({ i, kind, label: t.labels[0] ?? NO_LABEL })
        touchedSet.add(t.id)
        const what = h.kind === 'created' ? 'created' : h.kind === 'comment' ? 'commented on' : `moved to ${h.to}`
        const last = recent.find((r) => r.id === t.id && Math.abs(new Date(r.at).getTime() - at) < 3_600_000)
        if (last) {
          if (!last.what.includes(what)) last.what.push(what)
          if (h.at > last.at) last.at = h.at
        } else recent.push({ id: t.id, at: h.at, what: [what] })
      }
    }
    // By label: a task counts under its first label; beyond the busiest few, labels share one colour.
    const byLabel = new Map<string, number>()
    for (const e of events) byLabel.set(e.label, (byLabel.get(e.label) ?? 0) + 1)
    const top = [...byLabel.entries()].filter(([l]) => l !== NO_LABEL).sort((a, b) => b[1] - a[1]).slice(0, TOP_LABELS).map(([l]) => l)
    const labelKey = (l: string) => (l === NO_LABEL || top.includes(l) ? l : OTHER)
    const series = by === 'status'
      ? KINDS
      : [
          ...top.map((l) => ({ key: l, name: l, color: labelColour(ws, l) })),
          ...(events.some((e) => labelKey(e.label) === OTHER) ? [{ key: OTHER, name: 'Other labels', color: 'color-mix(in srgb, var(--fg) 45%, var(--bg))' }] : []),
          ...(byLabel.has(NO_LABEL) ? [{ key: NO_LABEL, name: 'No label', color: 'color-mix(in srgb, var(--fg) 22%, var(--bg))' }] : []),
        ]
    for (const e of events) {
      const key = by === 'status' ? e.kind : labelKey(e.label)
      buckets[e.i].counts[key] = (buckets[e.i].counts[key] ?? 0) + 1
    }
    recent.sort((a, b) => b.at.localeCompare(a.at))
    return { buckets, series, total: events.length, touched: touchedSet.size, recent: recent.slice(0, 8), step }
  }, [ws, project.id, days, by, now])
  const max = Math.max(1, ...buckets.map((b) => Object.values(b.counts).reduce((sum, n) => sum + n, 0)))
  const list = (what: string[]) => new Intl.ListFormat(undefined, { type: 'conjunction' }).format(what)
  const range = RANGES.find(([d]) => d === days)![1]
  const when = (d: Date) => d.toLocaleDateString(undefined, step === 1 ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })
  const toggle = <T extends string | number,>(label: string, value: T, options: readonly (readonly [T, string])[], set: (v: T) => void) => (
    <span role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-3)', borderRadius: 6 }}>
      {options.map(([v, name]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} onClick={() => set(v)} style={{ height: 24, padding: '0 8px', borderRadius: 5, background: value === v ? 'var(--bg)' : 'transparent', color: value === v ? 'var(--fg)' : 'var(--fg-3)', fontSize: 12.5 }}>{name}</button>
      ))}
    </span>
  )
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-2)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ marginRight: 'auto' }}><b className="num" style={{ color: 'var(--fg)' }}>{total}</b> change{total === 1 ? '' : 's'} across <b className="num" style={{ color: 'var(--fg)' }}>{touched}</b> task{touched === 1 ? '' : 's'} in the last {days === 365 ? 'year' : `${days} days`}</span>
        {toggle('Show by', by, [['status', 'Status'], ['label', 'Label']] as const, setBy)}
        {toggle('Range', days, RANGES, setDays)}
      </div>
      {total ? (
        <>
          <div role="img" aria-label={`Changes per ${step === 1 ? 'day' : 'week'} over ${range}`} style={{ height: 110, display: 'flex', alignItems: 'flex-end', gap: buckets.length > 60 ? 1 : 3, borderBottom: '1px solid var(--line)', margin: '12px 0 8px' }}>
            {buckets.map((b) => (
              <div key={b.day.toISOString()} title={`${step === 1 ? '' : 'Week of '}${when(b.day)}: ${series.map((x) => (b.counts[x.key] ? `${b.counts[x.key]} ${by === 'status' ? x.name.toLowerCase() : x.name}` : '')).filter(Boolean).join(', ') || 'no changes'}`} style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', gap: 1 }}>
                {series.map((x) => (b.counts[x.key] ? <i key={x.key} style={{ display: 'block', height: `${(b.counts[x.key] / max) * 100}px`, background: x.color, borderRadius: 2 }} /> : null))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--fg-3)', fontSize: 12 }}>
            {series.map((x) => <span key={x.key}><i className="dot" style={{ background: x.color, marginRight: 5 }} />{x.name}</span>)}
          </div>
        </>
      ) : (
        <p className="faint" style={{ margin: '10px 0 0' }}>No changes in the last {days === 365 ? 'year' : `${days} days`}.</p>
      )}
      {recent.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 8 }}>
          <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>Recent activity</div>
          {recent.map((r) => {
            const t = ws.tasks.find((x) => x.id === r.id)!
            const s = statusOf(ws, t.status)
            return (
              <div key={`${r.id}:${r.at}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <StatusIcon category={s.category} color={s.color} size={13} />
                <span className="num faint">{identifier(ws, t)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                <span className="faint">{list(r.what)}</span>
                <span className="faint" style={{ marginLeft: 'auto' }}>{ago(r.at, now)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Links a project relies on (Octarine's Resources; notes and files can't be reached from a Standard Notes editor). */
export function ProjectLinks({ project }: { project: Project }) {
  const { state, store } = useApp()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const add = () => {
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) return
    store.apply('Added link', (d) => ops.updateProject(d, project.id, { links: [...project.links, { title: title.trim() || u.replace(/^https?:\/\//, ''), url: u }] }))
    setTitle('')
    setUrl('')
  }
  const field = { height: 30, border: '1px solid var(--line-2)', borderRadius: 6, padding: '0 8px', background: 'var(--bg)' } as const
  return (
    <div>
      {project.links.map((l, i) => (
        <div key={`${l.url}:${i}`} className="subrow">
          <ExternalLink size={14} className="faint" />
          <a className="t" href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a>
          {!state.locked && <button className="icon-btn" aria-label={`Remove ${l.title}`} onClick={() => store.apply('Removed link', (d) => ops.updateProject(d, project.id, { links: project.links.filter((_, j) => j !== i) }), 'undo')}><X size={13} /></button>}
        </div>
      ))}
      {!project.links.length && <p className="faint" style={{ margin: '0 0 8px' }}>Keep the links this project relies on here.</p>}
      {!state.locked && (
        <form style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }} onSubmit={(e) => (e.preventDefault(), add())}>
          <input aria-label="Link title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...field, flex: '1 1 140px' }} />
          <input aria-label="Link URL" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} style={{ ...field, flex: '2 1 220px' }} />
          <button className="btn" type="submit" disabled={!/^https?:\/\//i.test(url.trim())}><Plus size={13} />Add link</button>
        </form>
      )}
    </div>
  )
}
