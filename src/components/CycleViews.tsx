import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { completeCycle, cycleName, cycleRange } from '../lib/cycles'
import type { Cycle } from '../lib/model/types'
import { identifier, isClosed } from '../lib/model/workspace'
import { useApp } from './context'

export const CycleIcon = RefreshCw

/** Ended cycles show what happened; active ones their plan. */
export function CycleSummary({ cycle }: { cycle: Cycle }) {
  const s = cycle.stats
  if (!s && !cycle.goal) return null
  const tile = (label: string, n: number) => (
    <div key={label} style={{ minWidth: 84, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-2)', padding: '6px 12px' }}>
      <div className="num" style={{ fontSize: 18, fontWeight: 600 }}>{n}</div>
      <div className="faint" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
  return (
    <section aria-label="Cycle summary" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
      {cycle.goal && <p style={{ margin: '0 0 8px', color: 'var(--fg-2)' }}>{cycle.goal}</p>}
      {s && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tile('Planned', s.planned)}
          {tile('Completed', s.completed)}
          {tile('Added', s.added)}
          {tile('Carried', s.carried)}
          {tile('Cancelled', s.cancelled)}
          {s.planned > 0 && tile('% plan completed', Math.round((s.plannedCompleted / s.planned) * 100))}
        </div>
      )}
    </section>
  )
}

export function CompleteCycleDialog({ cycleId, onClose }: { cycleId: string; onClose: () => void }) {
  const { state, store } = useApp()
  const ws = state.ws
  const cycle = ws.cycles.find((c) => c.id === cycleId)
  const upcoming = ws.cycles.filter((c) => c.state === 'upcoming').sort((a, b) => b.start.localeCompare(a.start))
  const tasks = ws.tasks.filter((t) => t.cycle === cycleId && !t.archived)
  const unfinished = tasks.filter((t) => !isClosed(ws, t))
  const [dest, setDest] = useState<Record<string, string | null>>(() => Object.fromEntries(unfinished.map((t) => [t.id, upcoming[0]?.id ?? null])))
  if (!cycle) return null
  const done = tasks.filter((t) => !unfinished.includes(t) && ws.statuses.find((s) => s.id === t.status)?.category === 'completed').length
  return (
    <>
      <div className="scrim" onPointerDown={onClose} />
      <div className="dialog" role="dialog" aria-label={`Complete ${cycleName(cycle)}`} onKeyDown={(e) => e.key === 'Escape' && onClose()} style={{ width: 560 }}>
        <div style={{ padding: '16px 18px 8px', fontWeight: 600, fontSize: 14 }}>Complete {cycleName(cycle)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '0 18px' }}>
          {[['Planned', cycle.planned.length], ['Completed', done], ['Unfinished', unfinished.length]].map(([l, n]) => (
            <div key={l} style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-2)', padding: 10 }}>
              <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{n}</div>
              <div className="faint">{l}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 18px', maxHeight: '40vh', overflow: 'auto' }}>
          {unfinished.length ? (
            <>
              <div className="sect" style={{ marginBottom: 8 }}>Decide where unfinished work goes</div>
              {!upcoming.length && <p className="faint">Create an upcoming cycle first if you want to carry work forward. Otherwise tasks return to the backlog.</p>}
              {unfinished.map((t) => (
                <div key={t.id} className="subrow">
                  <span className="num faint">{identifier(ws, t)}</span>
                  <span className="t">{t.title}</span>
                  <select aria-label={`Where ${identifier(ws, t)} goes`} value={dest[t.id] ?? ''} onChange={(e) => setDest((d) => ({ ...d, [t.id]: e.target.value || null }))}>
                    {upcoming.map((c) => <option key={c.id} value={c.id}>{cycleName(c)} · {cycleRange(c)}</option>)}
                    <option value="">Backlog (no cycle)</option>
                  </select>
                </div>
              ))}
            </>
          ) : (
            <p className="muted">Everything is closed. Nice work.</p>
          )}
        </div>
        <div className="dlg-foot" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => {
            store.apply(`Completed ${cycleName(cycle)}`, (d) => completeCycle(d, cycle.id, dest), 'undo')
            onClose()
          }}>Complete cycle</button>
        </div>
      </div>
    </>
  )
}
