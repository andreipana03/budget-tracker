import { afterEach, describe, expect, it } from 'vitest'

import { perDayText } from '@/features/home/home-text'

import { addRecentSearch, clearRecentSearches, readRecentSearches } from './recent-searches'
import { flattenPages, formatRate, groupByDay, repeatLabel, type Transaction, type TransactionPage } from './transactions'

function tx(id: string, day: string, home: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: 'expense',
    status: 'posted',
    title: id,
    note: null,
    occurredOn: day,
    occurredAt: null,
    category: { id: 'c', kind: 'expense', name: 'Groceries', color: 'mint', icon: 'shopping-cart', isFixed: false },
    account: { id: 'a', name: 'ING Card', type: 'bank', currency: 'RON' },
    amountMinor: home,
    currency: 'RON',
    accountAmountMinor: home,
    accountCurrency: 'RON',
    homeAmountMinor: home,
    homeCurrency: 'RON',
    fxRate: '1',
    fxRateDate: null,
    recurringId: null,
    recurringOccurrenceOn: null,
    rowVersion: 1,
    createdAt: '2026-11-18T10:00:00Z',
    updatedAt: '2026-11-18T10:00:00Z',
    ...extra,
  }
}

describe('day grouping', () => {
  it('groups by day in API order with the API day totals', () => {
    const items = [tx('lidl', '2026-11-18', 6430), tx('origo', '2026-11-18', 1400), tx('steam', '2026-11-17', 4975)]
    const groups = groupByDay(items, [
      { date: '2026-11-18', expenseHomeMinor: 8430, incomeHomeMinor: 0 },
      { date: '2026-11-17', expenseHomeMinor: 13025, incomeHomeMinor: 0 },
    ])
    expect(groups.map((g) => [g.date, g.items.map((t) => t.id), g.expenseHomeMinor])).toEqual([
      ['2026-11-18', ['lidl', 'origo'], 8430],
      ['2026-11-17', ['steam'], 13025],
    ])
  })

  it('sums posted items when a day has no total, ignoring pending ones', () => {
    const items = [
      tx('a', '2026-11-16', 1000),
      tx('b', '2026-11-16', 500, { status: 'pending' }),
      tx('c', '2026-11-16', 85000, { kind: 'income' }),
    ]
    const [g] = groupByDay(items, [])
    expect(g.expenseHomeMinor).toBe(1000)
    expect(g.incomeHomeMinor).toBe(85000)
  })

  it('merges a day that spans two pages and drops duplicates', () => {
    const page = (items: Transaction[], dayTotals: TransactionPage['dayTotals']): TransactionPage => ({
      items,
      dayTotals,
      nextCursor: null,
      homeCurrency: 'RON',
    })
    const { items, dayTotals } = flattenPages([
      page([tx('a', '2026-11-18', 100), tx('b', '2026-11-17', 200)], [
        { date: '2026-11-18', expenseHomeMinor: 100, incomeHomeMinor: 0 },
        { date: '2026-11-17', expenseHomeMinor: 500, incomeHomeMinor: 0 },
      ]),
      page([tx('b', '2026-11-17', 200), tx('c', '2026-11-17', 300)], [
        { date: '2026-11-17', expenseHomeMinor: 500, incomeHomeMinor: 0 },
      ]),
    ])
    const groups = groupByDay(items, dayTotals)
    expect(groups).toHaveLength(2)
    expect(groups[1].items.map((t) => t.id)).toEqual(['b', 'c'])
    expect(groups[1].expenseHomeMinor).toBe(500)
  })
})

describe('copy helpers', () => {
  it('formats exchange rates without floats', () => {
    expect(formatRate('4.9800000000')).toBe('4,98')
    expect(formatRate('4.97731')).toBe('4,9773')
    expect(formatRate('4.97738')).toBe('4,9774')
    expect(formatRate('1')).toBe('1,00')
    expect(formatRate('0.0312', '.')).toBe('0.0312')
  })

  it('names repeats', () => {
    expect(repeatLabel(undefined)).toBe('Never')
    expect(repeatLabel({ frequency: 'monthly', intervalCount: 1 })).toBe('Monthly')
    expect(repeatLabel({ frequency: 'weekly', intervalCount: 2 })).toBe('Every 2 weeks')
  })

  it('writes the daily amount with singular and plural days', () => {
    expect(perDayText(5500, 13, 'RON', 'RO')).toBe('About 55 lei a day for the next 13 days')
    expect(perDayText(5500, 1, 'RON', 'RO')).toBe('About 55 lei for today, the last day')
    expect(perDayText(0, 4, 'RON', 'RO')).toBe('Nothing left for flexible spending for the next 4 days')
  })
})

describe('recent searches', () => {
  afterEach(() => clearRecentSearches())

  it('keeps the newest five, case-insensitively unique', () => {
    for (const q of ['lidl', 'glovo', 'LIDL', 'a', 'b', 'c', 'd']) addRecentSearch(q)
    expect(readRecentSearches()).toEqual(['d', 'c', 'b', 'a', 'LIDL'])
  })
})
