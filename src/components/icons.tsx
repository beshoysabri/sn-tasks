/* eslint-disable react-refresh/only-export-components */
import {
  Archive, ArrowRightLeft, BookOpen, Briefcase, Calendar, CalendarClock, CalendarDays, CalendarOff, CalendarX2, Car, Check, CircleSlash, Code,
  Dumbbell, FolderKanban, Gift, Globe, GraduationCap, Hammer, Heart, Home, Inbox, Layers, Leaf, Lightbulb, Megaphone, MessageSquare, Music,
  Palette, PawPrint, Plane, Plus, RotateCcw, Shapes, ShoppingCart, Sprout, Star, Target, Users, Wallet, Wrench, type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Priority, StatusCategory } from '../lib/model/types'
import type { DueBucket } from '../lib/query'

const sz = (size: number) => ({ width: size, height: size, viewBox: '0 0 14 14' })

/** Category colours; a status's own colour overrides them. */
export const CATEGORY_COLOUR: Record<StatusCategory, string> = {
  backlog: 'var(--fg-4)',
  unstarted: 'var(--fg-3)',
  started: 'var(--started)',
  review: 'var(--review)',
  completed: 'var(--done)',
  cancelled: 'var(--fg-4)',
}

export function StatusIcon({ category, color, size = 14, label }: { category: StatusCategory; color?: string; size?: number; label?: string }) {
  const style: CSSProperties = { color: color || CATEGORY_COLOUR[category], flexShrink: 0 }
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  const ring = <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
  switch (category) {
    case 'backlog':
      return <svg {...sz(size)} style={style} {...a11y}><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2" /></svg>
    case 'unstarted':
      return <svg {...sz(size)} style={style} {...a11y}>{ring}</svg>
    case 'started':
      return <svg {...sz(size)} style={style} {...a11y}>{ring}<path d="M7 3.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor" /></svg>
    case 'review':
      return <svg {...sz(size)} style={style} {...a11y}>{ring}<path d="M7 3.4V7H3.4A3.6 3.6 0 1 0 7 3.4z" fill="currentColor" /></svg>
    case 'completed':
      return (
        <svg {...sz(size)} style={style} {...a11y}>
          <circle cx="7" cy="7" r="6.2" fill="currentColor" />
          <path d="m4.3 7.2 1.9 1.9 3.6-3.9" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'cancelled':
      return (
        <svg {...sz(size)} style={style} {...a11y}>
          <circle cx="7" cy="7" r="6.2" fill="currentColor" />
          <path d="m5 5 4 4M9 5 5 9" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
  }
}

export function PriorityIcon({ priority, size = 14, label }: { priority: Priority; size?: number; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  if (!priority)
    return (
      <svg {...sz(size)} style={{ color: 'var(--fg-4)', flexShrink: 0 }} {...a11y}>
        <circle cx="2.5" cy="7" r="1.1" fill="currentColor" />
        <circle cx="7" cy="7" r="1.1" fill="currentColor" />
        <circle cx="11.5" cy="7" r="1.1" fill="currentColor" />
      </svg>
    )
  if (priority === 1)
    return (
      <svg {...sz(size)} style={{ flexShrink: 0 }} {...a11y}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--urgent)" />
        <path d="M7 3.8v4" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.2" r=".95" fill="var(--bg)" />
      </svg>
    )
  const lit = { 2: 3, 3: 2, 4: 1 }[priority]
  const fill = (i: number) => (i < lit ? 'var(--fg-2)' : 'var(--line-2)')
  return (
    <svg {...sz(size)} style={{ flexShrink: 0 }} {...a11y}>
      <rect x="1.5" y="8" width="2.6" height="4.5" rx=".6" fill={fill(0)} />
      <rect x="5.7" y="5" width="2.6" height="7.5" rx=".6" fill={fill(1)} />
      <rect x="9.9" y="2" width="2.6" height="10.5" rx=".6" fill={fill(2)} />
    </svg>
  )
}

/** Icons a project or space can pick (Lucide names). */
export const ENTITY_ICONS: Record<string, LucideIcon> = {
  'folder-kanban': FolderKanban, globe: Globe, home: Home, wallet: Wallet, briefcase: Briefcase, leaf: Leaf, target: Target, star: Star,
  heart: Heart, 'book-open': BookOpen, code: Code, palette: Palette, megaphone: Megaphone, users: Users, 'graduation-cap': GraduationCap,
  dumbbell: Dumbbell, plane: Plane, car: Car, 'shopping-cart': ShoppingCart, gift: Gift, music: Music, sprout: Sprout, lightbulb: Lightbulb,
  wrench: Wrench, hammer: Hammer, 'paw-print': PawPrint, calendar: Calendar, inbox: Inbox, layers: Layers,
}

export function EntityIcon({ name, color, size = 15, fallback = FolderKanban }: { name?: string; color?: string; size?: number; fallback?: LucideIcon }) {
  const Icon = (name && ENTITY_ICONS[name]) || fallback
  return <Icon size={size} strokeWidth={1.6} style={{ color: color || 'var(--fg-3)', flexShrink: 0 }} aria-hidden />
}

export function DueIcon({ bucket, size = 13 }: { bucket: DueBucket; size?: number }) {
  const props = { size, strokeWidth: 1.7, 'aria-hidden': true as const }
  switch (bucket) {
    case 'overdue': return <CalendarX2 {...props} style={{ color: 'var(--attention)' }} />
    case 'today': return <Check {...props} />
    case 'week': return <CalendarClock {...props} />
    case 'none': return <CalendarOff {...props} />
    default: return <CalendarDays {...props} />
  }
}

export { Archive, ArrowRightLeft, CircleSlash, Layers, MessageSquare, Plus, RotateCcw, Shapes }
