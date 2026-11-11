/**
 * Live amount entry for the Add sheet (design § 6.11): what people type is cleaned as
 * they type, then turned into integer minor units with `parseAmount` (never floats).
 *
 *   sanitizeAmountInput('24.5', 'RON', ',')   → "24,5"     (either separator, shown the region's way)
 *   sanitizeAmountInput('24,567', 'RON', ',') → "24,56"    (max decimals = the currency's minor units)
 *   sanitizeAmountInput('1.500', 'JPY', ',')  → "1500"     (no minor units → separators are grouping)
 *   sanitizeAmountInput('007', 'RON', ',')    → "7"
 */
import { minorUnits, parseAmount } from '@/lib/format'

/** Whole-unit digits allowed (9.999.999.999 is plenty for a student budget). */
const MAX_INTEGER_DIGITS = 10

export function sanitizeAmountInput(raw: string, currency: string, decimalSep: string): string {
  const digits = minorUnits(currency)
  // Keep digits and separators only; the first separator typed is the decimal one.
  // Without minor units (JPY) a separator can only be grouping: drop them all.
  const cleaned = raw.replace(digits === 0 ? /[^0-9]/g : /[^0-9.,]/g, '')
  const sepIndex = cleaned.search(/[.,]/)
  let int = sepIndex === -1 ? cleaned : cleaned.slice(0, sepIndex)
  let frac = sepIndex === -1 ? null : cleaned.slice(sepIndex + 1).replace(/[.,]/g, '')

  int = int.replace(/^0+(?=\d)/, '').slice(0, MAX_INTEGER_DIGITS)
  if (frac !== null) {
    if (digits === 0) frac = null
    else {
      frac = frac.slice(0, digits)
      if (int === '') int = '0'
    }
  }
  return frac === null ? int : `${int}${decimalSep}${frac}`
}

/** The typed text → minor units (0 while empty or incomplete). */
export function amountMinorFromInput(text: string, currency: string): number {
  if (!text) return 0
  return parseAmount(text, currency) ?? 0
}

/**
 * Split typed text for display: integer part with the region's grouping ("1.234"), the
 * separator and the decimals the person has typed so far.
 */
export function amountDisplayParts(
  text: string,
  decimalSep: string,
  groupSep: string,
): { integer: string; separator: string; fraction: string } {
  const i = text.indexOf(decimalSep)
  const int = i === -1 ? text : text.slice(0, i)
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep)
  return { integer: grouped, separator: i === -1 ? '' : decimalSep, fraction: i === -1 ? '' : text.slice(i + 1) }
}
