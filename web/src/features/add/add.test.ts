import { describe, expect, it } from 'vitest'

import { amountDisplayParts, amountMinorFromInput, sanitizeAmountInput } from './amount-entry'
import { pickDefaults } from './defaults'
import { buildHint } from './hint'
import { uuidv7, uuidv7Time } from './uuidv7'

describe('amount entry', () => {
  it('accepts comma or dot and shows the region separator', () => {
    expect(sanitizeAmountInput('24.5', 'RON', ',')).toBe('24,5')
    expect(sanitizeAmountInput('24,50', 'RON', ',')).toBe('24,50')
    expect(sanitizeAmountInput('24,50', 'USD', '.')).toBe('24.50')
    expect(amountMinorFromInput('24,5', 'RON')).toBe(2450)
    expect(amountMinorFromInput('24.50', 'RON')).toBe(2450)
  })

  it("caps decimals at the currency's minor units", () => {
    expect(sanitizeAmountInput('24,567', 'RON', ',')).toBe('24,56')
    expect(sanitizeAmountInput('1,2,3', 'RON', ',')).toBe('1,23')
    expect(sanitizeAmountInput(',5', 'RON', ',')).toBe('0,5')
    expect(amountMinorFromInput('0,5', 'RON')).toBe(50)
  })

  it('has no decimals for JPY', () => {
    expect(sanitizeAmountInput('1500', 'JPY', ',')).toBe('1500')
    expect(sanitizeAmountInput('15,5', 'JPY', ',')).toBe('155')
    expect(sanitizeAmountInput('1.500', 'JPY', ',')).toBe('1500')
    expect(amountMinorFromInput('1500', 'JPY')).toBe(1500)
  })

  it('drops junk and leading zeros', () => {
    expect(sanitizeAmountInput('007', 'RON', ',')).toBe('7')
    expect(sanitizeAmountInput('12a3 lei', 'RON', ',')).toBe('123')
    expect(sanitizeAmountInput('-5', 'RON', ',')).toBe('5')
    expect(sanitizeAmountInput('', 'RON', ',')).toBe('')
    expect(amountMinorFromInput('', 'RON')).toBe(0)
    expect(amountMinorFromInput('0', 'RON')).toBe(0)
  })

  it('never uses floats', () => {
    expect(amountMinorFromInput('0,29', 'RON')).toBe(29)
    expect(amountMinorFromInput('1234,29', 'RON')).toBe(123429)
  })

  it('splits text for display with grouping', () => {
    expect(amountDisplayParts('1234,5', ',', '.')).toEqual({ integer: '1.234', separator: ',', fraction: '5' })
    expect(amountDisplayParts('24', ',', '.')).toEqual({ integer: '24', separator: '', fraction: '' })
    expect(amountDisplayParts('24,', ',', '.')).toEqual({ integer: '24', separator: ',', fraction: '' })
  })
})

describe('Add defaults', () => {
  const categories = [
    { id: 'groceries', kind: 'expense' as const },
    { id: 'eating', kind: 'expense' as const },
    { id: 'salary', kind: 'income' as const },
    { id: 'gifts', kind: 'income' as const },
  ]
  const accounts = [{ id: 'ing' }, { id: 'cash' }]
  const tx = (kind: 'expense' | 'income', category: string, account: string, recurringId: string | null = null) => ({
    kind,
    recurringId,
    category: { id: category },
    account: { id: account },
  })

  it('uses the last manual transaction of that kind', () => {
    const recent = [tx('expense', 'eating', 'cash', 'sub-1'), tx('expense', 'eating', 'cash'), tx('expense', 'groceries', 'ing')]
    // The first one is a subscription charge: skipped.
    expect(pickDefaults({ kind: 'expense', categories, accounts, recent })).toEqual({ categoryId: 'eating', accountId: 'cash' })
  })

  it('ignores the other kind and subscription charges', () => {
    const recent = [tx('income', 'gifts', 'cash', 'sub-allowance'), tx('expense', 'eating', 'cash'), tx('income', 'gifts', 'cash')]
    expect(pickDefaults({ kind: 'income', categories, accounts, recent })).toEqual({ categoryId: 'gifts', accountId: 'cash' })
  })

  it('falls back to the first category and account', () => {
    expect(pickDefaults({ kind: 'expense', categories, accounts, recent: [] })).toEqual({
      categoryId: 'groceries',
      accountId: 'ing',
    })
    expect(pickDefaults({ kind: 'income', categories, accounts, recent: [] }).categoryId).toBe('salary')
  })

  it('skips archived (missing) categories and accounts', () => {
    const recent = [tx('expense', 'archived-cat', 'closed-account')]
    expect(pickDefaults({ kind: 'expense', categories, accounts, recent })).toEqual({ categoryId: 'groceries', accountId: 'ing' })
  })

  it('lets a preset category win', () => {
    const recent = [tx('expense', 'eating', 'cash')]
    expect(pickDefaults({ kind: 'expense', categories, accounts, recent, presetCategoryId: 'groceries' })).toEqual({
      categoryId: 'groceries',
      accountId: 'cash',
    })
    // A preset of the wrong kind is ignored.
    expect(pickDefaults({ kind: 'expense', categories, accounts, recent, presetCategoryId: 'salary' }).categoryId).toBe('eating')
  })
})

describe('live hint', () => {
  const RO = 'RO'
  const groceries = { category: { name: 'Groceries' }, limitMinor: 60000, spentMinor: 24640 }
  const eating = { category: { name: 'Eating Out' }, limitMinor: 30000, spentMinor: 32750 }

  it('says what is left after this', () => {
    expect(buildHint({ line: groceries, amountHomeMinor: 2450, homeCurrency: 'RON', region: RO })).toEqual({
      text: '329,10 lei left in Groceries after this',
      over: false,
    })
  })

  it('says what is left before an amount is typed', () => {
    expect(buildHint({ line: groceries, amountHomeMinor: 0, homeCurrency: 'RON', region: RO })?.text).toBe(
      '353,60 lei left in Groceries',
    )
  })

  it('warns when it would go over', () => {
    expect(buildHint({ line: { ...eating, spentMinor: 29750 }, amountHomeMinor: 5450, homeCurrency: 'RON', region: RO })).toEqual({
      text: 'This puts Eating Out 52,00 lei over',
      over: true,
    })
  })

  it('marks converted amounts and ignores what an edited transaction already counts', () => {
    expect(
      buildHint({ line: groceries, amountHomeMinor: 4975, approx: true, homeCurrency: 'RON', region: RO })?.text,
    ).toBe('≈ 303,85 lei left in Groceries after this')
    expect(
      buildHint({ line: groceries, amountHomeMinor: 2450, alreadyCountedMinor: 2450, homeCurrency: 'RON', region: RO })?.text,
    ).toBe('353,60 lei left in Groceries after this')
  })

  it('has nothing to say without a budget', () => {
    expect(buildHint({ line: undefined, amountHomeMinor: 100, homeCurrency: 'RON' })).toBeNull()
    expect(buildHint({ line: { ...groceries, limitMinor: null }, amountHomeMinor: 100, homeCurrency: 'RON' })).toBeNull()
  })
})

describe('uuidv7', () => {
  const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('has the v7 format', () => {
    for (let i = 0; i < 50; i++) expect(uuidv7()).toMatch(V7)
  })

  it('carries the timestamp in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 18, 12, 0, 0)
    expect(uuidv7Time(uuidv7(now))).toBe(now)
    expect(uuidv7(now, new Uint8Array(10)).startsWith(now.toString(16).padStart(12, '0').slice(0, 8))).toBe(true)
  })

  it('sorts by creation time and is unique', () => {
    const a = uuidv7(1_000)
    const b = uuidv7(2_000)
    expect(a < b).toBe(true)
    expect(new Set(Array.from({ length: 200 }, () => uuidv7())).size).toBe(200)
  })

  it('sets the version and variant bits whatever the random bytes', () => {
    expect(uuidv7(0, new Uint8Array(10).fill(0xff))).toBe('00000000-0000-7fff-bfff-ffffffffffff')
    expect(uuidv7(0, new Uint8Array(10))).toBe('00000000-0000-7000-8000-000000000000')
  })
})
