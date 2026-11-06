/**
 * Money formatting (design § 6.7, § 8). Amounts arrive as integer minor units
 * (bani, cents) + an ISO currency code and are never turned into floats: the
 * decimal string is built from the integer and handed to Intl as a string.
 *
 *   formatMoney(123429, 'RON')                       → "1.234,29 lei"
 *   formatMoney(999, 'EUR')                          → "9,99 €"
 *   formatMoney(85000, 'RON', { kind: 'income' })    → "+850,00 lei"
 *   formatMoney(200000, 'RON', { whole: true })      → "2.000 lei"
 *   formatMoney(388230, 'RON', { approx: true })     → "≈ 3.882,30 lei"
 *   formatOver(2750, 'RON')                          → "27,50 lei over"
 *
 * Expenses never get a minus sign (Apple Wallet convention); a genuinely negative
 * value (an overdrawn account) gets U+2212 "−". Spaces are plain U+0020.
 */
import { localeForRegion, normalizeSpaces } from './locale'

export type EntryKind = 'expense' | 'income'

export interface MoneyOptions {
  /** ISO 3166 region deciding separators ("RO"). Defaults to the browser's region. */
  region?: string | null
  /** `income` adds a leading "+". */
  kind?: EntryKind
  /** Round half away from zero to whole units: "2.000 lei". */
  whole?: boolean
  /** Prefix "≈ " for totals that include converted amounts. */
  approx?: boolean
}

const minorUnitsCache = new Map<string, number>()

/** Digits after the decimal point for a currency, from Intl: RON 2, EUR 2, JPY 0. */
export function minorUnits(currency: string): number {
  const cached = minorUnitsCache.get(currency)
  if (cached !== undefined) return cached
  let digits = 2
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    digits = 2
  }
  minorUnitsCache.set(currency, digits)
  return digits
}

/** Integer minor units → whole major units, rounded half away from zero (exact integer math). */
export function roundMinorToWhole(minor: number, currency: string): number {
  const factor = 10 ** minorUnits(currency)
  const abs = Math.abs(minor)
  const whole = Math.floor((abs + factor / 2) / factor)
  return minor < 0 ? -whole : whole
}

/** 123429, 2 → "1234.29" (absolute value, no sign). */
export function minorToDecimalString(minor: number, digits: number): string {
  const s = String(Math.abs(Math.trunc(minor))).padStart(digits + 1, '0')
  if (digits === 0) return s
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`
}

export interface MoneyParts {
  /** "", "+" or "−" */
  sign: string
  /** "≈ " or "" */
  approx: string
  /** "1.234" */
  integer: string
  /** "," (region decimal separator) or "" for whole/zero-decimal currencies */
  decimalSeparator: string
  /** "29" or "" */
  fraction: string
  /** "lei", "€" */
  symbol: string
  /** Where the symbol sits for this region ("1,00 €" → after; "$1.00" → before) */
  symbolPosition: 'before' | 'after'
  /** The whole formatted string, same as formatMoney */
  text: string
}

type NumericString = `${number}`

function currencyFormatter(locale: string, currency: string, digits: number) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Structured money, for layouts that style the parts (hero amount: small decimals, label-2 currency). */
export function formatMoneyParts(minor: number, currency: string, opts: MoneyOptions = {}): MoneyParts {
  const locale = localeForRegion(opts.region)
  const digits = minorUnits(currency)
  const value = opts.whole ? roundMinorToWhole(minor, currency) : minor
  const shownDigits = opts.whole ? 0 : digits
  const decimal = (opts.whole ? String(Math.abs(value)) : minorToDecimalString(value, digits)) as NumericString
  const parts = currencyFormatter(locale, currency, shownDigits).formatToParts(decimal)

  let integer = ''
  let decimalSeparator = ''
  let fraction = ''
  let symbol = ''
  let symbolPosition: 'before' | 'after' = 'after'
  let seenNumber = false
  for (const p of parts) {
    if (p.type === 'integer' || p.type === 'group') {
      integer += p.value
      seenNumber = true
    } else if (p.type === 'decimal') decimalSeparator = p.value
    else if (p.type === 'fraction') fraction = p.value
    else if (p.type === 'currency') {
      symbol = p.value
      symbolPosition = seenNumber ? 'after' : 'before'
    }
  }

  const sign = value < 0 ? '−' : opts.kind === 'income' && value !== 0 ? '+' : ''
  const approx = opts.approx ? '≈ ' : ''
  const body = normalizeSpaces(parts.map((p) => p.value).join(''))
  return {
    sign,
    approx,
    integer: normalizeSpaces(integer),
    decimalSeparator,
    fraction,
    symbol,
    symbolPosition,
    text: `${approx}${sign}${body}`,
  }
}

/** "1.234,29 lei" — see the module comment for every option. */
export function formatMoney(minor: number, currency: string, opts: MoneyOptions = {}): string {
  return formatMoneyParts(minor, currency, opts).text
}

/** "27,50 lei over" — always the absolute amount; pair with `text-negative` and an icon. */
export function formatOver(minor: number, currency: string, opts: Omit<MoneyOptions, 'kind'> = {}): string {
  return `${formatMoney(Math.abs(minor), currency, opts)} over`
}

/**
 * An amount without its currency, for copy like "327,50 of 300 lei" or legend
 * values "246". `whole` rounds half away from zero.
 */
export function formatMinorNumber(
  minor: number,
  currency: string,
  opts: { region?: string | null; whole?: boolean } = {},
): string {
  const locale = localeForRegion(opts.region)
  const digits = opts.whole ? 0 : minorUnits(currency)
  const value = opts.whole ? roundMinorToWhole(minor, currency) : minor
  const decimal = (opts.whole ? String(Math.abs(value)) : minorToDecimalString(value, digits)) as NumericString
  const s = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(decimal)
  return `${value < 0 ? '−' : ''}${normalizeSpaces(s)}`
}

/** A plain integer in the region's grouping: 1987 → "1.987" (chart axes, "Avg 1.987"). */
export function formatInteger(value: number, opts: { region?: string | null } = {}): string {
  const s = new Intl.NumberFormat(localeForRegion(opts.region), { maximumFractionDigits: 0 }).format(Math.abs(Math.round(value)))
  return `${value < 0 ? '−' : ''}${normalizeSpaces(s)}`
}

/** 0.27 → "27%" (rounded to a whole percent). */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** The currency's short symbol in this region: RON → "lei", EUR → "€". */
export function currencySymbol(currency: string, opts: { region?: string | null } = {}): string {
  return formatMoneyParts(0, currency, opts).symbol || currency
}
