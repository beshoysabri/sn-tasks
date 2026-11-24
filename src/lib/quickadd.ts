/**
 * Quick add, as in Octarine's new-task title: `#label` (known labels, or a new one with a letter in
 * it), `!urgent !high !medium !med !low !1–4`, and a natural-language date at the end of the title
 * ("fri", "next tuesday", "Dec 12"). Tokens are returned with their positions so the field can
 * colour them; a token the user chose to keep as text (Backspace right after it) is left alone.
 */
import * as chrono from 'chrono-node'
import type { Priority } from './model/types'
import { normaliseLabel, today } from './model/workspace'

export type TokenKind = 'label' | 'priority' | 'date'

export interface Token {
  kind: TokenKind
  start: number
  end: number
  /** label name, priority number as text, or YYYY-MM-DD */
  value: string
}

export interface Parsed {
  title: string
  labels: string[]
  priority: Priority | null
  due: string | null
  tokens: Token[]
}

const LABEL = /(^|\s)#([\p{L}\p{N}_/-]+)/gu
const PRIORITY = /(^|\s)!([a-z1-4]+)(?=\s|$)/giu
const PRIORITY_WORDS: Record<string, Priority> = { urgent: 1, high: 2, medium: 3, med: 3, low: 4, 1: 1, 2: 2, 3: 3, 4: 4 }
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
/** Identity of a token for "keep as text": its kind and its text. */
export const tokenKey = (kind: TokenKind, text: string) => `${kind}:${squash(text).toLowerCase()}`

export interface ParseOptions {
  knownLabels: string[]
  createLabels?: boolean
  parseDates?: boolean
  keptAsText?: string[]
  now?: Date
}

function labelTokens(text: string, known: Map<string, string>, create: boolean, kept: Set<string>): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(LABEL)) {
    const raw = m[2]
    const name = known.get(raw.toLowerCase()) ?? (create && /\p{L}/u.test(raw) ? normaliseLabel(raw) : undefined)
    if (!name || kept.has(tokenKey('label', `#${raw}`))) continue
    const start = (m.index ?? 0) + m[1].length
    out.push({ kind: 'label', start, end: start + raw.length + 1, value: name })
  }
  return out
}

function priorityTokens(text: string, kept: Set<string>): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(PRIORITY)) {
    const p = PRIORITY_WORDS[m[2].toLowerCase()]
    if (!p || kept.has(tokenKey('priority', `!${m[2]}`))) continue
    const start = (m.index ?? 0) + m[1].length
    out.push({ kind: 'priority', start, end: start + m[2].length + 1, value: String(p) })
  }
  return out
}

/** A date counts only at the end of the title, with title text before it. */
function dateToken(text: string, others: Token[], now: Date, kept: Set<string>): Token | null {
  const results = chrono.parse(text, now, { forwardDate: true })
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i]
    const start = r.index
    const end = start + r.text.length
    if (r.text.trim().length < 3 || kept.has(tokenKey('date', r.text))) continue
    if (others.some((t) => start < t.end && end > t.start)) continue
    if (!(r.start.isCertain('day') || r.start.isCertain('weekday') || r.start.isCertain('month'))) continue
    let after = text.slice(end)
    for (const t of others.filter((o) => o.start >= end)) after = after.replace(text.slice(t.start, t.end), '')
    const before = squash(text.slice(0, start)).replace(/[#!]\S+/g, '').trim()
    if (after.trim() || !before) continue
    return { kind: 'date', start, end, value: today(r.start.date()) }
  }
  return null
}

export function parseTitle(text: string, options: ParseOptions): Parsed {
  const kept = new Set(options.keptAsText ?? [])
  const known = new Map(options.knownLabels.map((l) => [l.toLowerCase(), l]))
  const labels = labelTokens(text, known, options.createLabels ?? true, kept)
  const priorities = options.parseDates === false ? [] : priorityTokens(text, kept)
  const others = [...labels, ...priorities]
  const date = options.parseDates === false ? null : dateToken(text, others, options.now ?? new Date(), kept)
  const tokens = [...others, ...(date ? [date] : [])].sort((a, b) => a.start - b.start)
  let title = ''
  let at = 0
  for (const t of tokens) {
    title += text.slice(at, t.start)
    at = t.end
  }
  title += text.slice(at)
  return {
    title: squash(title),
    labels: [...new Set(labels.map((t) => t.value))],
    priority: priorities.length ? (Number(priorities[priorities.length - 1].value) as Priority) : null,
    due: date?.value ?? null,
    tokens,
  }
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DATE_WORDS = ['today', 'tomorrow', ...WEEKDAYS, 'next week', 'next month', ...WEEKDAYS.map((d) => `next ${d}`)]

export interface Completion {
  /** The full text once accepted (with a trailing space). */
  value: string
  /** The grey part shown after the caret. */
  ghost: string
}

/** Ghost-text completion for the word being typed at the end: #lab → #label, !h → !high, tom → tomorrow. */
export function completeTitle(text: string, knownLabels: string[]): Completion | null {
  const m = /(^|\s)(\S+)$/u.exec(text)
  if (!m) return null
  const word = m[2]
  const lower = word.toLowerCase()
  const at = m.index + m[1].length
  const finish = (full: string) => (full.length > word.length ? { value: `${text.slice(0, at)}${full} `, ghost: full.slice(word.length) } : null)
  if (word.startsWith('#')) {
    const typed = lower.slice(1)
    if (!typed) return null
    const hit = knownLabels.find((l) => l.toLowerCase().startsWith(typed) && l.length > typed.length)
    return hit ? finish(`#${hit}`) : null
  }
  if (word.startsWith('!')) {
    const typed = lower.slice(1)
    const hit = ['urgent', 'high', 'medium', 'low'].find((p) => p.startsWith(typed))
    return hit ? finish(`!${hit}`) : null
  }
  const phrase = /(?:^|\s)((?:next\s+)?\S+)$/iu.exec(text)
  if (!phrase) return null
  const typed = phrase[1].toLowerCase().replace(/\s+/g, ' ')
  const start = text.length - phrase[1].length
  if (!text.slice(0, start).trim()) return null
  const rest = typed.startsWith('next ') ? typed.slice(5) : null
  if (rest === null ? typed.length < 3 : !rest) return null
  const hit = DATE_WORDS.find((d) => d.startsWith(typed) && d !== typed)
  if (!hit) return null
  const ghost = hit.slice(typed.length)
  return { value: `${text}${ghost} `, ghost }
}
