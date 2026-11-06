import { describe, expect, it } from 'vitest'

import { diffBudgets, INVALID_AMOUNT, initialDrafts, parseLimit } from './budget-edit'

describe('budget edit diffing', () => {
  const limits = { groceries: 60000, eating: 30000, fun: null as number | null, other: 8000 }

  it('prefills the current limits, empty for none', () => {
    expect(initialDrafts({ a: 60000, b: 25050, c: null }, 'RON', 'RO')).toEqual({ a: '600', b: '250,50', c: '' })
  })

  it('sends nothing when nothing changed (including reformatted text)', () => {
    const d = diffBudgets(limits, { groceries: '600', eating: '300,00', fun: '', other: '80' }, 'RON')
    expect(d.items).toEqual([])
    expect(d.errors).toEqual({})
    expect(d.totalMinor).toBe(98000)
  })

  it('sends only the changed items, in order', () => {
    const d = diffBudgets(limits, { groceries: '650', eating: '300', fun: '150', other: '80' }, 'RON', [
      'groceries',
      'eating',
      'fun',
      'other',
    ])
    expect(d.items).toEqual([
      { categoryId: 'groceries', amountMinor: 65000 },
      { categoryId: 'fun', amountMinor: 15000 },
    ])
    expect(d.totalMinor).toBe(65000 + 30000 + 15000 + 8000)
  })

  it('sends null for a cleared field', () => {
    const d = diffBudgets(limits, { groceries: '600', eating: '  ', fun: '', other: '80' }, 'RON')
    expect(d.items).toEqual([{ categoryId: 'eating', amountMinor: null }])
    expect(d.totalMinor).toBe(68000)
  })

  it('accepts 0 as a real limit', () => {
    const d = diffBudgets({ fun: null }, { fun: '0' }, 'RON')
    expect(d.items).toEqual([{ categoryId: 'fun', amountMinor: 0 }])
  })

  it('flags fields that do not parse and leaves them out', () => {
    const d = diffBudgets(limits, { groceries: '6x0', eating: '300,555', fun: '', other: '80' }, 'RON')
    expect(d.items).toEqual([])
    expect(d.errors).toEqual({ groceries: INVALID_AMOUNT, eating: INVALID_AMOUNT })
    // invalid fields count at their current limit in the total
    expect(d.totalMinor).toBe(98000)
  })

  it('parses a single field', () => {
    expect(parseLimit('', 'RON')).toBeNull()
    expect(parseLimit('1.250,5', 'RON')).toBe(125050)
    expect(parseLimit('abc', 'RON')).toBeUndefined()
  })
})
