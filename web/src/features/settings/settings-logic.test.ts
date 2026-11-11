import { describe, expect, it } from 'vitest'

import {
  allTimeZones,
  matchesTimeZone,
  monthStartExample,
  parseSignedAmount,
  regionOptions,
  signedAmountInput,
  timeZoneParts,
} from './settings-logic'

describe('monthStartExample', () => {
  it('explains a shifted month with the current month', () => {
    expect(monthStartExample(10, '2026-11')).toBe('With 10, the November budget runs 10 Nov – 9 Dec.')
    expect(monthStartExample(25, '2026-12')).toBe('With 25, the December budget runs 25 Dec – 24 Jan.')
  })
  it('explains calendar months for day 1', () => {
    expect(monthStartExample(1, '2026-11')).toBe('The November budget runs 1 – 30 Nov, like the calendar.')
    expect(monthStartExample(1, '2028-02')).toBe('The February budget runs 1 – 29 Feb, like the calendar.')
  })
})

describe('opening balance', () => {
  it('parses signed amounts without floats', () => {
    expect(parseSignedAmount('', 'RON')).toBe(0)
    expect(parseSignedAmount('1.234,56', 'RON')).toBe(123456)
    expect(parseSignedAmount('-250,5', 'RON')).toBe(-25050)
    expect(parseSignedAmount('−12', 'EUR')).toBe(-1200)
    expect(parseSignedAmount('-0', 'RON')).toBe(0)
    expect(parseSignedAmount('-', 'RON')).toBe(0)
    expect(parseSignedAmount('12,345', 'RON')).toBeNull()
    expect(parseSignedAmount('abc', 'RON')).toBeNull()
  })
  it('round-trips into the field', () => {
    expect(signedAmountInput(-25050, 'RON', 'RO')).toBe('-250,50')
    expect(signedAmountInput(120000, 'RON', 'RO')).toBe('1200')
    expect(signedAmountInput(0, 'RON', 'RO')).toBe('')
  })
})

describe('regions and time zones', () => {
  it('adds the current region when it is not offered', () => {
    const opts = regionOptions('JP')
    expect(opts.map((o) => o.value)).toContain('JP')
    expect(opts.find((o) => o.value === 'RO')?.label).toBe('Romania')
  })
  it('splits and searches zones', () => {
    expect(timeZoneParts('America/Argentina/Buenos_Aires')).toEqual({ city: 'Buenos Aires', area: 'America' })
    expect(matchesTimeZone('Europe/Bucharest', 'buch')).toBe(true)
    expect(matchesTimeZone('Europe/Bucharest', 'tokyo')).toBe(false)
    expect(allTimeZones(['Europe/Bucharest'])).toContain('Europe/Bucharest')
  })
})
