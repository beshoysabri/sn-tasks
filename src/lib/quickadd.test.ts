import { describe, expect, it } from 'vitest'
import { completeTitle, parseTitle, tokenKey } from './quickadd'

// Tuesday 24 November 2026, local noon.
const now = new Date(2026, 10, 24, 12, 0)
const opts = { knownLabels: ['Admin', 'Docs', 'Design'], now }

describe('quick add', () => {
  it('picks out a label, a priority and a date at the end', () => {
    const p = parseTitle('Renew the domain #admin !high fri', opts)
    expect(p.title).toBe('Renew the domain')
    expect(p.labels).toEqual(['Admin'])
    expect(p.priority).toBe(2)
    expect(p.due).toBe('2026-11-27')
    expect(p.tokens.map((t) => t.kind)).toEqual(['label', 'priority', 'date'])
  })

  it('understands tomorrow, next week and month names', () => {
    expect(parseTitle('Call the bank tomorrow', opts).due).toBe('2026-11-25')
    expect(parseTitle('Plan the trip next tuesday', opts).due).toBe('2026-12-01')
    expect(parseTitle('Pay the tax Dec 12', opts).due).toBe('2026-12-12')
  })

  it('needs the date at the end and some title before it', () => {
    expect(parseTitle('Friday review notes', opts).due).toBeNull()
    expect(parseTitle('tomorrow', opts).due).toBeNull()
  })

  it('creates new labels with a letter, keeps #123 as text', () => {
    const p = parseTitle('Fix #123 on #mobile app', opts)
    expect(p.labels).toEqual(['mobile'])
    expect(p.title).toBe('Fix #123 on app')
  })

  it('reads every priority word', () => {
    for (const [word, value] of [['urgent', 1], ['high', 2], ['med', 3], ['medium', 3], ['low', 4], ['1', 1]] as const)
      expect(parseTitle(`Task !${word}`, opts).priority).toBe(value)
  })

  it('leaves a token alone once kept as text', () => {
    const p = parseTitle('Write the Friday report fri', { ...opts, keptAsText: [tokenKey('date', 'fri')] })
    expect(p.due).toBeNull()
    expect(p.title).toBe('Write the Friday report fri')
  })

  it('completes labels, priorities and date words', () => {
    expect(completeTitle('Pay #ad', ['Admin'])).toEqual({ value: 'Pay #Admin ', ghost: 'min' })
    expect(completeTitle('Pay !h', [])).toEqual({ value: 'Pay !high ', ghost: 'igh' })
    expect(completeTitle('Pay rent tom', [])).toEqual({ value: 'Pay rent tomorrow ', ghost: 'orrow' })
    expect(completeTitle('Pay rent next fr', [])).toEqual({ value: 'Pay rent next friday ', ghost: 'iday' })
    expect(completeTitle('to', [])).toBeNull()
  })
})
