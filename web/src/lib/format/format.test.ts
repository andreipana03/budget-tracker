import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  currencySymbol,
  dayHeaderParts,
  daysBetween,
  dueParts,
  formatDateTime,
  formatDay,
  formatDayHeader,
  formatDue,
  formatEyebrow,
  formatInteger,
  formatLongDate,
  formatMediumDate,
  formatMinorNumber,
  formatMoney,
  formatMoneyParts,
  formatMonthName,
  formatMonthYear,
  formatOver,
  formatPercent,
  formatShortDate,
  formatTime,
  localeForRegion,
  minorUnits,
  parseAmount,
  roundMinorToWhole,
  startOfWeek,
  toAmountInput,
} from '.'

const RO = { region: 'RO' }
const TODAY = '2026-11-18' // Wednesday

describe('locale', () => {
  it('maps a region to a number-format locale', () => {
    expect(localeForRegion('RO')).toBe('ro-RO')
    expect(localeForRegion('DE')).toBe('de-DE')
    expect(localeForRegion('US')).toBe('en-US')
  })
})

describe('money', () => {
  it('knows minor units per currency', () => {
    expect(minorUnits('RON')).toBe(2)
    expect(minorUnits('EUR')).toBe(2)
    expect(minorUnits('JPY')).toBe(0)
  })

  it('formats minor units in the region', () => {
    expect(formatMoney(123429, 'RON', RO)).toBe('1.234,29 lei')
    expect(formatMoney(999, 'EUR', RO)).toBe('9,99 €')
    expect(formatMoney(6430, 'RON', RO)).toBe('64,30 lei')
    expect(formatMoney(5, 'RON', RO)).toBe('0,05 lei')
    expect(formatMoney(0, 'RON', RO)).toBe('0,00 lei')
    expect(formatMoney(1234, 'JPY', RO)).toBe('1.234 ¥')
    expect(formatMoney(123429, 'EUR', { region: 'DE' })).toBe('1.234,29 €')
  })

  it('shows expenses without a sign and income with "+"', () => {
    expect(formatMoney(6430, 'RON', { ...RO, kind: 'expense' })).toBe('64,30 lei')
    expect(formatMoney(85000, 'RON', { ...RO, kind: 'income' })).toBe('+850,00 lei')
  })

  it('uses a real minus for negative values', () => {
    expect(formatMoney(-5000, 'RON', RO)).toBe('−50,00 lei')
  })

  it('formats whole units, rounding half away from zero', () => {
    expect(formatMoney(200000, 'RON', { ...RO, whole: true })).toBe('2.000 lei')
    expect(formatMoney(5500, 'RON', { ...RO, whole: true })).toBe('55 lei')
    expect(`About ${formatMoney(5450, 'RON', { ...RO, whole: true })} a day`).toBe('About 55 lei a day')
    expect(formatMoney(5449, 'RON', { ...RO, whole: true })).toBe('54 lei')
    expect(roundMinorToWhole(-150, 'RON')).toBe(-2)
    expect(roundMinorToWhole(149, 'RON')).toBe(1)
  })

  it('prefixes approximations', () => {
    expect(formatMoney(388230, 'RON', { ...RO, approx: true })).toBe('≈ 3.882,30 lei')
    expect(formatMoney(16287, 'RON', { ...RO, approx: true })).toBe('≈ 162,87 lei')
  })

  it('says "over"', () => {
    expect(formatOver(2750, 'RON', RO)).toBe('27,50 lei over')
    expect(formatOver(-2750, 'RON', RO)).toBe('27,50 lei over')
  })

  it('splits parts for hero layouts', () => {
    const p = formatMoneyParts(76571, 'RON', RO)
    expect(p).toMatchObject({ integer: '765', decimalSeparator: ',', fraction: '71', symbol: 'lei', symbolPosition: 'after' })
    expect(p.text).toBe('765,71 lei')
    expect(formatMoneyParts(123429, 'RON', RO).integer).toBe('1.234')
    expect(formatMoneyParts(999, 'USD', { region: 'US' }).symbolPosition).toBe('before')
  })

  it('formats bare numbers and percentages', () => {
    expect(formatMinorNumber(32750, 'RON', RO)).toBe('327,50')
    expect(formatMinorNumber(24640, 'RON', { ...RO, whole: true })).toBe('246')
    expect(formatInteger(1987, RO)).toBe('1.987')
    expect(formatInteger(0, RO)).toBe('0')
    expect(formatPercent(0.27)).toBe('27%')
    expect(currencySymbol('RON', RO)).toBe('lei')
    expect(currencySymbol('EUR', RO)).toBe('€')
  })
})

describe('parseAmount', () => {
  it('accepts comma or dot as the decimal separator', () => {
    expect(parseAmount('24,50', 'RON')).toBe(2450)
    expect(parseAmount('24.50', 'RON')).toBe(2450)
    expect(parseAmount('24.5', 'RON')).toBe(2450)
    expect(parseAmount('24', 'RON')).toBe(2400)
    expect(parseAmount('0,05', 'RON')).toBe(5)
    expect(parseAmount(',5', 'RON')).toBe(50)
  })

  it('accepts mid-typing input', () => {
    expect(parseAmount('12,', 'RON')).toBe(1200)
    expect(parseAmount('12.', 'RON')).toBe(1200)
  })

  it('strips grouping', () => {
    expect(parseAmount('1.234,56', 'RON')).toBe(123456)
    expect(parseAmount('1,234.56', 'RON')).toBe(123456)
    expect(parseAmount('1.234.567', 'RON')).toBe(123456700)
    expect(parseAmount('1 234,5', 'RON')).toBe(123450)
  })

  it('rejects too many decimals and junk', () => {
    expect(parseAmount('1,234', 'RON')).toBeNull()
    expect(parseAmount('1,999', 'EUR')).toBeNull()
    expect(parseAmount('', 'RON')).toBeNull()
    expect(parseAmount(',', 'RON')).toBeNull()
    expect(parseAmount('12a', 'RON')).toBeNull()
    expect(parseAmount('-5', 'RON')).toBeNull()
    expect(parseAmount('1,2,3', 'RON')).toBeNull()
    expect(parseAmount('12.34.5', 'RON')).toBeNull()
  })

  it('respects currencies without minor units', () => {
    expect(parseAmount('500', 'JPY')).toBe(500)
    expect(parseAmount('5,5', 'JPY')).toBeNull()
  })

  it('never loses precision to floats', () => {
    expect(parseAmount('0,29', 'RON')).toBe(29)
    expect(parseAmount('1234,29', 'RON')).toBe(123429)
    expect(parseAmount('9999999999999,99', 'RON')).toBe(999999999999999)
    expect(parseAmount('99999999999999,99', 'RON')).toBeNull()
  })

  it('writes amounts back for editing', () => {
    expect(toAmountInput(2450, 'RON', RO)).toBe('24,50')
    expect(toAmountInput(2400, 'RON', RO)).toBe('24')
    expect(toAmountInput(5, 'RON', RO)).toBe('0,05')
    expect(toAmountInput(2450, 'USD', { region: 'US' })).toBe('24.50')
  })
})

describe('dates', () => {
  it('does calendar-day math without time zones', () => {
    expect(daysBetween('2026-11-18', '2026-11-21')).toBe(3)
    expect(daysBetween('2026-10-25', '2026-10-26')).toBe(1) // DST change in Europe
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(startOfWeek('2026-11-18')).toBe('2026-11-16')
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16') // Sunday belongs to the week starting Monday
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16')
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })

  it('says Today, Yesterday, then the short date', () => {
    expect(formatDay('2026-11-18', TODAY)).toBe('Today')
    expect(formatDay('2026-11-17', TODAY)).toBe('Yesterday')
    expect(formatDay('2026-11-19', TODAY)).toBe('Tomorrow')
    expect(formatDay('2026-11-16', TODAY)).toBe('Mon 16 Nov')
    expect(formatShortDate('2026-12-01')).toBe('Tue 1 Dec')
    expect(formatShortDate('2025-12-01', TODAY)).toBe('Mon 1 Dec 2025')
  })

  it('formats day headers', () => {
    expect(formatDayHeader('2026-11-18', TODAY)).toBe('Today · Wed 18 Nov')
    expect(formatDayHeader('2026-11-17', TODAY)).toBe('Yesterday · Tue 17 Nov')
    expect(formatDayHeader('2026-11-16', TODAY)).toBe('Monday, 16 November')
    expect(dayHeaderParts('2026-11-18', TODAY)).toEqual({ title: 'Today', detail: 'Wed 18 Nov' })
  })

  it('formats long dates and the eyebrow', () => {
    expect(formatLongDate('2026-11-18')).toBe('Wednesday, 18 November')
    expect(formatEyebrow('2026-11-18')).toBe('WEDNESDAY, 18 NOVEMBER')
    expect(formatMediumDate('2026-11-17')).toBe('17 Nov 2026')
  })

  it('formats due dates', () => {
    expect(formatDue('2026-11-21', TODAY)).toBe('In 3 days · Sat 21 Nov')
    expect(formatDue('2026-11-25', TODAY)).toBe('In 7 days · Wed 25 Nov')
    expect(formatDue('2026-12-01', TODAY)).toBe('Tue 1 Dec')
    expect(formatDue('2026-11-18', TODAY)).toBe('Today · Wed 18 Nov')
    expect(formatDue('2026-11-19', TODAY)).toBe('Tomorrow · Thu 19 Nov')
    expect(dueParts('2026-11-15', TODAY)).toEqual({ relative: '3 days ago', date: 'Sun 15 Nov' })
  })

  it('formats timestamps in a time zone', () => {
    expect(formatDateTime('2026-11-17T19:14:00Z', 'Europe/Bucharest')).toBe('17 Nov 2026, 21:14')
    expect(formatTime('2026-11-17T19:14:00Z', 'Europe/Bucharest')).toBe('21:14')
  })

  it('names months', () => {
    expect(formatMonthName('2026-11')).toBe('November')
    expect(formatMonthName('2026-11-18')).toBe('November')
    expect(formatMonthYear('2026-11')).toBe('November 2026')
  })
})
