/**
 * Typed amounts ↔ integer minor units, by string handling only (never floats).
 *
 *   parseAmount('24,50', 'RON')    → 2450
 *   parseAmount('24.5', 'RON')     → 2450
 *   parseAmount('1.234,56', 'RON') → 123456
 *   parseAmount('12,', 'RON')      → 1200   (mid-typing)
 *   parseAmount('1,234', 'RON')    → null   (3 decimals; RON allows 2)
 *   parseAmount('500', 'JPY')      → 500    (JPY has no minor units)
 *   parseAmount('5,5', 'JPY')      → null
 *
 * Either "," or "." is the decimal separator: the last separator in the string is the
 * decimal one unless it appears more than once ("1.234.567" is grouping). Earlier
 * separators are grouping and must sit between groups of three digits.
 */
import { localeForRegion } from './locale'
import { minorToDecimalString, minorUnits } from './money'

const MAX_DIGITS = 15 // keeps every result a safe integer

export function parseAmount(input: string, currency: string): number | null {
  const digits = minorUnits(currency)
  const s = input.replace(/[\s  ']/g, '')
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null

  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'))
  let intPart = s
  let frac = ''
  if (lastSep !== -1) {
    const sepChar = s[lastSep]
    const isGroupingOnly = s.split(sepChar).length > 2 && !s.includes(sepChar === ',' ? '.' : ',')
    if (!isGroupingOnly) {
      intPart = s.slice(0, lastSep)
      frac = s.slice(lastSep + 1)
    }
  }
  if (/[.,]/.test(frac)) return null
  if (/[.,]/.test(intPart)) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(intPart)) return null
    intPart = intPart.replace(/[.,]/g, '')
  }
  if (frac.length > digits) return null
  if (intPart === '' && frac === '') return null

  const all = `${intPart || '0'}${frac.padEnd(digits, '0')}`.replace(/^0+(?=\d)/, '')
  if (all.length > MAX_DIGITS) return null
  return Number(all)
}

/**
 * Minor units → the text to put back in an amount field, with the region's decimal
 * separator and no grouping: 2450 → "24,50" (RO). Trailing ",00" is dropped: 2400 → "24".
 */
export function toAmountInput(minor: number, currency: string, opts: { region?: string | null } = {}): string {
  const digits = minorUnits(currency)
  const [i, f] = minorToDecimalString(minor, digits).split('.')
  if (!f || /^0+$/.test(f)) return i
  return `${i}${decimalSeparator(opts)}${f}`
}

/** The decimal separator people expect in this region ("," for RO). */
export function decimalSeparator(opts: { region?: string | null } = {}): string {
  return (
    new Intl.NumberFormat(localeForRegion(opts.region)).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ??
    ','
  )
}
