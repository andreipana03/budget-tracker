import { describe, expect, it } from 'vitest'

import { accountIcon } from '@/lib/account-icon'

import { accountsFooter } from './home-text'

const acct = (over: Partial<{ archived: boolean; includeInTotal: boolean }> = {}) => ({
  archived: false,
  includeInTotal: true,
  ...over,
})

describe('Home › Accounts footer', () => {
  it('has nothing to say for a plain home-currency total', () => {
    expect(accountsFooter({ totalIsApproximate: false, items: [acct(), acct()] })).toBeUndefined()
  })

  it('explains the ≈ total', () => {
    expect(accountsFooter({ totalIsApproximate: true, items: [acct()] })).toBe(
      'Other currencies are converted at today’s BNR rate.',
    )
  })

  it('says when an active account is left out of the total', () => {
    expect(accountsFooter({ totalIsApproximate: true, items: [acct(), acct({ includeInTotal: false })] })).toBe(
      'Other currencies are converted at today’s BNR rate. Accounts with Include in Total off aren’t counted.',
    )
  })

  it('ignores archived accounts that are out of the total', () => {
    expect(
      accountsFooter({ totalIsApproximate: false, items: [acct(), acct({ archived: true, includeInTotal: false })] }),
    ).toBeUndefined()
  })
})

describe('account icon (sidebar and Home › Accounts)', () => {
  it('uses Money for cash, Globe for other currencies, CreditCard otherwise', () => {
    expect(accountIcon({ type: 'cash', currency: 'EUR' }, 'RON')).toBe('money')
    expect(accountIcon({ type: 'bank', currency: 'EUR' }, 'RON')).toBe('globe-hemisphere-west')
    expect(accountIcon({ type: 'credit_card', currency: 'RON' }, 'RON')).toBe('credit-card')
  })
})
