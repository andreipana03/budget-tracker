import { describe, expect, it } from 'vitest'

import { balanceAfter, impliedRate, isExchange, pickTransferAccounts, rateText, transferSpokenTitle, transferTitle } from './transfers'

const RO = { region: 'RO' }

const ref = (id: string, name: string, currency = 'RON') => ({ id, name, type: 'bank' as const, currency })

describe('transfer titles', () => {
  it('names both accounts, with words for screen readers', () => {
    const tr = { fromAccount: ref('a', 'ING Card'), toAccount: ref('b', 'Cash') }
    expect(transferTitle(tr)).toBe('ING Card → Cash')
    expect(transferSpokenTitle(tr)).toBe('ING Card to Cash')
    expect(isExchange(tr)).toBe(false)
    expect(isExchange({ ...tr, toAccount: ref('c', 'Revolut', 'EUR') })).toBe(true)
  })
})

describe('default accounts', () => {
  const accounts = [
    { id: 'ing', currency: 'RON', archived: false },
    { id: 'rev', currency: 'EUR', archived: false },
    { id: 'old', currency: 'RON', archived: true },
    { id: 'cash', currency: 'RON', archived: false },
  ]

  it('goes from the first account to the next one in the same currency', () => {
    expect(pickTransferAccounts(accounts)).toEqual({ fromId: 'ing', toId: 'cash' })
  })

  it('uses usable presets and never the same account twice', () => {
    expect(pickTransferAccounts(accounts, { fromAccountId: 'rev' })).toEqual({ fromId: 'rev', toId: 'ing' })
    expect(pickTransferAccounts(accounts, { toAccountId: 'ing' })).toEqual({ fromId: 'rev', toId: 'ing' })
    expect(pickTransferAccounts(accounts, { fromAccountId: 'old' })).toEqual({ fromId: 'ing', toId: 'cash' })
    expect(pickTransferAccounts(accounts, { fromAccountId: 'cash', toAccountId: 'cash' })).toEqual({ fromId: 'cash', toId: 'ing' })
  })

  it('has nothing to offer with fewer than two active accounts', () => {
    expect(pickTransferAccounts([accounts[0]])).toEqual({ fromId: 'ing', toId: null })
    expect(pickTransferAccounts([])).toEqual({ fromId: null, toId: null })
  })
})

describe('balance after the transfer', () => {
  const ing = { id: 'ing', balanceMinor: 214030 }
  const cash = { id: 'cash', balanceMinor: 18600 }

  it('takes from one side and adds to the other', () => {
    const t = { fromId: 'ing', toId: 'cash', sendMinor: 20000, receiveMinor: 20000 }
    expect(balanceAfter({ account: ing, ...t })).toBe(194030)
    expect(balanceAfter({ account: cash, ...t })).toBe(38600)
  })

  it("leaves out the edited transfer's current effect", () => {
    // ING → Cash 200 lei is already in both balances; it's being changed to 150 lei.
    const original = { fromAccount: ref('ing', 'ING Card'), toAccount: ref('cash', 'Cash'), fromAmountMinor: 20000, toAmountMinor: 20000 }
    const t = { fromId: 'ing', toId: 'cash', sendMinor: 15000, receiveMinor: 15000, original }
    expect(balanceAfter({ account: ing, ...t })).toBe(219030)
    // Swapped direction: Cash → ING.
    expect(balanceAfter({ account: cash, ...t, fromId: 'cash', toId: 'ing' })).toBe(18600 - 20000 - 15000)
  })
})

describe('exchange rates', () => {
  it('reads the rate the way that is at least 1', () => {
    expect(rateText('4.9800000000', 'EUR', 'RON', RO)).toBe('1 € = 4,98 lei')
    expect(rateText('0.2008032129', 'RON', 'EUR', RO)).toBe('1 € = 4,98 lei')
    expect(rateText('160.25', 'EUR', 'JPY', RO)).toBe('1 € = 160,25 ¥')
    expect(rateText('nonsense', 'EUR', 'RON', RO)).toBeNull()
  })

  it('works out the rate two amounts imply, without floats', () => {
    expect(impliedRate(10000, 'RON', 1990, 'EUR')).toBe('0.1990000000')
    expect(rateText(impliedRate(10000, 'RON', 1990, 'EUR')!, 'RON', 'EUR', RO)).toBe('1 € = 5,0251 lei')
    expect(impliedRate(1000, 'EUR', 1602, 'JPY')).toBe('160.2000000000') // 10,00 € → 1.602 ¥ (no minor units)
    expect(impliedRate(0, 'RON', 1, 'EUR')).toBeNull()
  })
})
