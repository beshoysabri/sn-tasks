import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { Task } from '../lib/model/types'
import { identifier, isClosed, projectOf, statusOf } from '../lib/model/workspace'
import { upNext } from '../lib/query'
import { useApp } from './context'
import { EntityIcon, PriorityIcon, StatusIcon } from './icons'
import { Markdown } from './ui'
import * as ops from '../lib/ops'

/** A space's Overview: its projects as cards, its own upkeep tasks, and what's up next across it. */
export function SpaceOverview({ spaceId, onOpenProject, onOpenTask, onCreate }: { spaceId: string; onOpenProject: (id: string) => void; onOpenTask: (t: Task) => void; onCreate: (defaults: { space: string }) => void }) {
  const { state, store } = useApp()
  const ws = state.ws
  const space = ws.spaces.find((s) => s.id === spaceId)
  const [desc, setDesc] = useState(space?.description ?? '')
  const [editing, setEditing] = useState(false)
  if (!space) return null
  const projects = ws.projects.filter((p) => p.space === space.id && !p.archived)
  const active = projects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled')
  const completed = projects.filter((p) => p.status === 'completed')
  const own = ws.tasks.filter((t) => !t.project && t.space === space.id && !t.archived && !isClosed(ws, t))
  const inSpace = ws.tasks.filter((t) => (t.project ? projects.some((p) => p.id === t.project) : t.space === space.id))
  const next = upNext(ws, inSpace).slice(0, 5)
  const row = (t: Task, detail?: string) => {
    const s = statusOf(ws, t.status)
    return (
      <button key={t.id} className="subrow" style={{ width: '100%' }} onClick={() => onOpenTask(t)}>
        <PriorityIcon priority={t.priority} />
        <StatusIcon category={s.category} color={s.color} />
        <span className="num faint" style={{ width: 64 }}>{identifier(ws, t)}</span>
        <span className="t">{t.title}</span>
        {detail && <span className="faint" style={{ fontSize: 12 }}>{detail}</span>}
      </button>
    )
  }
  return (
    <div className="scroll">
      <div style={{ maxWidth: 920, padding: '22px 32px 48px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <EntityIcon name={space.icon} color={space.color} size={28} />
        <div style={{ fontSize: 24, fontWeight: 600 }}>{space.name}</div>
        {editing ? (
          <textarea className="desc-input" autoFocus value={desc} aria-label="Space description" onChange={(e) => setDesc(e.target.value)} onBlur={() => (store.apply('Space', (d) => ops.updateSpace(d, space.id, { description: desc })), setEditing(false))} />
        ) : (
          <div onClick={() => !state.locked && (setDesc(space.description), setEditing(true))}>
            {space.description ? <Markdown className="desc" text={space.description} /> : <div className="desc placeholder">Add a description…</div>}
          </div>
        )}
        <div className="sect" style={{ marginTop: 8 }}>Projects <span className="faint">· {active.length} active</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
          {active.map((p) => {
            const tasks = ws.tasks.filter((t) => t.project === p.id && !t.archived && statusOf(ws, t.status).category !== 'cancelled')
            const done = tasks.filter((t) => statusOf(ws, t.status).category === 'completed').length
            const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0
            return (
              <button key={p.id} onClick={() => onOpenProject(p.id)} style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-2)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><EntityIcon name={p.icon} color={p.color} size={15} /><b style={{ fontWeight: 500 }}>{p.name}</b><span className="faint num" style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12 }}>{p.key}</span></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--bg-3)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--done)' }} /></span>
                  <span className="num muted" style={{ fontSize: 12 }}>{pct}%</span>
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{done} of {tasks.length} done{p.target ? ` · target ${p.target}` : ''}</span>
              </button>
            )
          })}
          {!active.length && <p className="faint" style={{ margin: 0 }}>No active projects. Move one here from its Settings.</p>}
        </div>
        <div className="sect" style={{ marginTop: 8 }}>
          Space tasks <span className="faint">· not in a project</span>
          {!state.locked && <button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label="Add a task to this space" onClick={() => onCreate({ space: space.id })}><Plus size={14} /></button>}
        </div>
        <div>{own.length ? own.map((t) => row(t)) : <p className="faint" style={{ margin: 0 }}>Keep the upkeep that never becomes a project here, like “Renew domain” or “Monthly invoices”.</p>}</div>
        <div className="sect" style={{ marginTop: 8 }}>Up next across this space</div>
        <div>{next.length ? next.map((t) => row(t, projectOf(ws, t)?.name)) : <p className="faint" style={{ margin: 0 }}>Nothing open here. Enjoy the quiet.</p>}</div>
        {completed.length > 0 && <div className="faint" style={{ marginTop: 8 }}>Completed projects: {completed.map((p) => p.name).join(', ')}</div>}
      </div>
    </div>
  )
}
