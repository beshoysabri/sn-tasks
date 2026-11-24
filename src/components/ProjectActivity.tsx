import { ExternalLink, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Project, StatusCategory } from '../lib/model/types'
import { identifier, statusOf } from '../lib/model/workspace'
import * as ops from '../lib/ops'
import { useApp } from './context'
import { StatusIcon } from './icons'
import { ago } from './ui'

type Series = 'created' | 'comment' | StatusCategory
const SERIES: { key: Series; name: string; color: string }[] = [
  { key: 'created', name: 'Created', color: 'color-mix(in srgb, var(--fg) 30%, var(--bg))' },
  { key: 'started', name: 'In progress', color: 'var(--started)' },
  { key: 'review', name: 'In review', color: 'var(--review)' },
  { key: 'completed', name: 'Done', color: 'var(--done)' },
  { key: 'comment', name: 'Comments', color: 'color-mix(in srgb, var(--accent) 45%, var(--bg))' },
]
const RANGES = [7, 30, 90] as const

/** Changes per day across a project's tasks, stacked by what they were (Octarine's Activity card). */
export function ProjectActivity({ project, now }: { project: Project; now: number }) {
  const { state } = useApp()
  const ws = state.ws
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const { buckets, total, touched, recent } = useMemo(() => {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (days - 1))
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return { day: d, counts: {} as Partial<Record<Series, number>> }
    })
    let total = 0
    const touchedSet = new Set<string>()
    const recent: { id: string; at: string; what: string[] }[] = []
    const tasks = ws.tasks.filter((t) => t.project === project.id)
    for (const t of tasks) {
      for (const h of t.history) {
        const series: Series | null = h.kind === 'created' ? 'created' : h.kind === 'comment' ? 'comment' : h.kind === 'status' ? (ws.statuses.find((s) => s.name === h.to)?.category ?? null) : null
        if (!series) continue
        const at = new Date(h.at).getTime()
        const i = Math.floor((at - start.getTime()) / 86_400_000)
        if (i < 0 || i >= days) continue
        buckets[i].counts[series] = (buckets[i].counts[series] ?? 0) + 1
        total++
        touchedSet.add(t.id)
        const what = h.kind === 'created' ? 'created' : h.kind === 'comment' ? 'commented on' : `moved to ${h.to}`
        const last = recent.find((r) => r.id === t.id && Math.abs(new Date(r.at).getTime() - at) < 3_600_000)
        if (last) {
          if (!last.what.includes(what)) last.what.push(what)
          if (h.at > last.at) last.at = h.at
        } else recent.push({ id: t.id, at: h.at, what: [what] })
      }
    }
    recent.sort((a, b) => b.at.localeCompare(a.at))
    return { buckets, total, touched: touchedSet.size, recent: recent.slice(0, 8) }
  }, [ws, project.id, days, now])
  const max = Math.max(1, ...buckets.map((b) => Object.values(b.counts).reduce((s, n) => s + (n ?? 0), 0)))
  const list = (what: string[]) => new Intl.ListFormat(undefined, { type: 'conjunction' }).format(what)
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-2)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span className="muted"><b className="num" style={{ color: 'var(--fg)' }}>{total}</b> change{total === 1 ? '' : 's'} across <b className="num" style={{ color: 'var(--fg)' }}>{touched}</b> task{touched === 1 ? '' : 's'} in the last {days} days</span>
        <span role="radiogroup" aria-label="Range" style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-3)', borderRadius: 6 }}>
          {RANGES.map((r) => (
            <button key={r} role="radio" aria-checked={days === r} onClick={() => setDays(r)} style={{ height: 24, padding: '0 8px', borderRadius: 5, background: days === r ? 'var(--bg)' : 'transparent', color: days === r ? 'var(--fg)' : 'var(--fg-3)', fontSize: 12.5 }}>{r} days</button>
          ))}
        </span>
      </div>
      {total ? (
        <>
          <div role="img" aria-label={`Changes per day over ${days} days`} style={{ height: 110, display: 'flex', alignItems: 'flex-end', gap: days > 60 ? 1 : 3, borderBottom: '1px solid var(--line)', margin: '12px 0 8px' }}>
            {buckets.map((b) => (
              <div key={b.day.toISOString()} title={`${b.day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${SERIES.map((s) => (b.counts[s.key] ? `${b.counts[s.key]} ${s.name.toLowerCase()}` : '')).filter(Boolean).join(', ') || 'no changes'}`} style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', gap: 1 }}>
                {SERIES.map((s) => (b.counts[s.key] ? <i key={s.key} style={{ display: 'block', height: `${(b.counts[s.key]! / max) * 100}px`, background: s.color, borderRadius: 2 }} /> : null))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--fg-3)', fontSize: 12 }}>
            {SERIES.map((s) => <span key={s.key}><i className="dot" style={{ background: s.color, marginRight: 5 }} />{s.name}</span>)}
          </div>
        </>
      ) : (
        <p className="faint" style={{ margin: '10px 0 0' }}>No changes in the last {days} days.</p>
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
