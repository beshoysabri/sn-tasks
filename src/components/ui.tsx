/* eslint-disable react-refresh/only-export-components */
import { CalendarClock, CalendarDays } from 'lucide-react'
import { marked, type Tokens } from 'marked'
import { useEffect, useMemo, useRef } from 'react'
import type { Workspace } from '../lib/model/types'
import { labelColour } from '../lib/model/workspace'
import { useApp } from './context'

/** Markdown for descriptions and comments. Raw HTML is shown as text; links open outside. */
function renderMarkdown(text: string): string {
  const renderer = new marked.Renderer()
  renderer.html = ({ text: html }: Tokens.HTML | Tokens.Tag) => html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  renderer.link = ({ href, text: label }: Tokens.Link) => {
    const safe = /^(https?:|mailto:)/i.test(href) ? href : '#'
    return `<a href="${safe.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${label}</a>`
  }
  renderer.checkbox = ({ checked }: Tokens.Checkbox) => `<input type="checkbox" ${checked ? 'checked' : ''}>`
  return marked.parse(text, { renderer, gfm: true, breaks: true, async: false }) as string
}

/** Ticks the n-th "- [ ]" box in Markdown text. */
export function toggleCheckbox(text: string, index: number): string {
  let n = -1
  return text.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/gm, (m, a, mark, b) => {
    n++
    return n === index ? `${a}${mark === ' ' ? 'x' : ' '}${b}` : m
  })
}

export function Markdown({ text, onToggle, className }: { text: string; onToggle?: (index: number) => void; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const boxes = [...(ref.current?.querySelectorAll('input[type=checkbox]') ?? [])] as HTMLInputElement[]
    boxes.forEach((box, i) => {
      box.disabled = !onToggle
      box.onclick = (e) => {
        e.stopPropagation()
        onToggle?.(i)
      }
    })
  }, [html, onToggle])
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

/** The clipboard API is refused in Standard Notes' sandbox; execCommand('copy') on a user gesture works. */
export function copyText(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

export function LabelPill({ ws, name, small }: { ws: Workspace; name: string; small?: boolean }) {
  return (
    <span className={`label${small ? ' sm' : ''}`} title={name}>
      <i className="dot" style={{ background: labelColour(ws, name) }} />
      {name}
    </span>
  )
}

export function Labels({ ws, names, small }: { ws: Workspace; names: string[]; small?: boolean }) {
  if (!names.length) return null
  return (
    <span className="labels" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {names.slice(0, 3).map((n) => <LabelPill key={n} ws={ws} name={n} small={small} />)}
      {names.length > 3 && <span className="faint" title={names.slice(3).join(', ')}>+{names.length - 3}</span>}
    </span>
  )
}

const DAY = 86_400_000

/** Today / Tomorrow / Yesterday, else "Nov 19" (with the year when it isn't this year). */
export function dueText(due: string, now: number): string {
  const d = new Date(`${due}T00:00:00`)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString(undefined, d.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

export function Due({ due, overdue, now }: { due?: string; overdue: boolean; now: number }) {
  if (!due) return null
  const Icon = overdue ? CalendarClock : CalendarDays
  return (
    <span className={`due${overdue ? ' over' : ''}`} title={`Due ${new Date(`${due}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })}${overdue ? ' · Overdue' : ''}`}>
      <Icon size={13} strokeWidth={1.7} aria-hidden />
      {dueText(due, now)}
    </span>
  )
}

/** "Nov 19" this year, "Nov 2025" otherwise (Octarine's created column). */
export function createdText(stamp: string, now: number): string {
  const d = new Date(stamp)
  if (Number.isNaN(d.getTime())) return ''
  return d.getFullYear() === new Date(now).getFullYear() ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** 5m, 3h, 2d, 3w ago, else a date. */
export function ago(stamp: string, now: number): string {
  const t = new Date(stamp).getTime()
  if (Number.isNaN(t)) return ''
  const m = Math.max(1, Math.round((now - t) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  if (d < 60) return `${Math.round(d / 7)}w ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ToastView() {
  const { state, store } = useApp()
  const toast = state.toast
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => store.dismissToast(toast.id), toast.action ? 6000 : 3000)
    return () => clearTimeout(timer)
  }, [toast, store])
  if (!toast) return null
  return (
    <div className="toast" role="status">
      <span className="t">{toast.text}</span>
      {toast.action && (
        <button
          className="btn"
          onClick={() => {
            toast.action!.run()
            store.dismissToast(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

export function ConfirmDialog() {
  const { ui, setUi } = useApp()
  const c = ui.confirm
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus(), [c])
  if (!c) return null
  const close = () => setUi({ confirm: null })
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="dialog" role="alertdialog" aria-label={c.title} style={{ width: 460, top: '22vh' }} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div style={{ padding: '16px 18px 6px', fontWeight: 600, fontSize: 14 }}>{c.title}</div>
        <p style={{ margin: 0, padding: '0 18px 16px', color: 'var(--fg-2)', lineHeight: 1.5 }}>{c.body}</p>
        <div className="dlg-foot" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={close}>{c.danger ? 'Cancel' : 'Go back'}</button>
          <button
            ref={ok}
            className={`btn ${c.danger ? 'danger' : 'primary'}`}
            onClick={() => {
              close()
              c.run()
            }}
          >
            {c.confirm}
          </button>
        </div>
      </div>
    </>
  )
}

/** Closes something on Escape or a click outside the element. */
let pressTimer: ReturnType<typeof setTimeout> | undefined
let pressAt: { x: number; y: number } | null = null
let swallowClick = false

/**
 * Long-press on a touch screen opens a menu (iOS never fires contextmenu). Moving the finger, as in a
 * scroll, cancels it, and the tap that ends a long-press doesn't also open the task.
 */
export function longPress(open: (x: number, y: number) => void) {
  const cancel = () => {
    clearTimeout(pressTimer)
    pressAt = null
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      swallowClick = false
      if (e.pointerType !== 'touch') return
      cancel()
      const at = { x: e.clientX, y: e.clientY }
      pressAt = at
      pressTimer = setTimeout(() => {
        pressAt = null
        swallowClick = true
        open(at.x, at.y)
      }, 500)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
}

export function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [ref, onClose, active])
}
