/** Pure helpers for Settings (tested in settings-logic.test.ts). */
import type { IconName } from '@/components/ui/Icon'
import type { components } from '@/lib/api/schema.gen'
import { parseAmount, toAmountInput } from '@/lib/format'

export type AccountType = components['schemas']['AccountType']

export const ACCOUNT_TYPES: readonly { value: AccountType; label: string; icon: IconName }[] = [
  { value: 'cash', label: 'Cash', icon: 'money' },
  { value: 'bank', label: 'Bank', icon: 'bank' },
  { value: 'credit_card', label: 'Credit Card', icon: 'credit-card' },
  { value: 'savings', label: 'Savings', icon: 'piggy-bank' },
  { value: 'other', label: 'Other', icon: 'wallet' },
]

export function accountType(value: string) {
  return ACCOUNT_TYPES.find((t) => t.value === value) ?? ACCOUNT_TYPES[4]
}

const MONTH_SHORT = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
const MONTH_LONG = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })

/**
 * Footer for "Month Starts On", using the current month's name:
 *   (10, '2026-11') → "With 10, the November budget runs 10 Nov – 9 Dec."
 *   (1,  '2026-11') → "The November budget runs 1 – 30 Nov, like the calendar."
 */
export function monthStartExample(day: number, month: string): string {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const name = MONTH_LONG.format(start)
  if (day <= 1) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return `The ${name} budget runs 1 – ${last} ${MONTH_SHORT.format(start)}, like the calendar.`
  }
  const next = new Date(Date.UTC(y, m, 1))
  return `With ${day}, the ${name} budget runs ${day} ${MONTH_SHORT.format(start)} – ${day - 1} ${MONTH_SHORT.format(next)}.`
}

/** Regions offered for number formatting (ISO 3166). The person's own is added if missing. */
export const FORMAT_REGIONS = ['RO', 'MD', 'DE', 'FR', 'IT', 'ES', 'NL', 'AT', 'CH', 'GB', 'IE', 'US'] as const

let regionNames: Intl.DisplayNames | null = null
export function regionName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

export function regionOptions(current?: string | null): { value: string; label: string }[] {
  const codes: string[] = [...FORMAT_REGIONS]
  if (current && !codes.includes(current)) codes.unshift(current)
  return codes.map((c) => ({ value: c, label: regionName(c) })).sort((a, b) => a.label.localeCompare(b.label))
}

/** Every IANA time zone the browser knows (falls back to the given ones). */
export function allTimeZones(include: string[] = []): string[] {
  let zones: string[] = []
  try {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
    zones = intl.supportedValuesOf?.('timeZone') ?? []
  } catch {
    zones = []
  }
  const set = new Set([...zones, ...include.filter(Boolean)])
  if (set.size === 0) set.add('Europe/Bucharest')
  return [...set].sort()
}

/** "Europe/Bucharest" → { city: "Bucharest", area: "Europe" }; "America/Argentina/Buenos_Aires" → Buenos Aires · America. */
export function timeZoneParts(zone: string): { city: string; area: string } {
  const parts = zone.split('/')
  const city = (parts.length > 1 ? parts[parts.length - 1] : zone).replace(/_/g, ' ')
  const area = parts.length > 1 ? parts[0].replace(/_/g, ' ') : ''
  return { city, area }
}

const offsetCache = new Map<string, string>()
/** "GMT+2" for the zone right now ("GMT" when it can't be read). */
export function timeZoneOffset(zone: string, now = new Date()): string {
  const cached = offsetCache.get(zone)
  if (cached) return cached
  let label = 'GMT'
  try {
    label =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  } catch {
    // unknown zone
  }
  offsetCache.set(zone, label)
  return label
}

export function matchesTimeZone(zone: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const { city, area } = timeZoneParts(zone)
  return [zone.replace(/_/g, ' '), city, area, timeZoneOffset(zone)].some((s) => s.toLowerCase().includes(q))
}

/**
 * A typed opening balance → signed minor units. Empty is 0; a leading "-" or "−"
 * makes it negative (credit cards). Returns null when it isn't an amount.
 */
export function parseSignedAmount(input: string, currency: string): number | null {
  const s = input.trim()
  if (!s) return 0
  const negative = /^[-−]/.test(s)
  const rest = negative ? s.slice(1).trim() : s
  if (!rest) return 0
  const minor = parseAmount(rest, currency)
  if (minor === null) return null
  return negative && minor !== 0 ? -minor : minor
}

/** Signed minor units → the text for the field ("−" kept as "-" so it can be edited). */
export function signedAmountInput(minor: number, currency: string, region?: string | null): string {
  if (minor === 0) return ''
  const text = toAmountInput(Math.abs(minor), currency, { region })
  return minor < 0 ? `-${text}` : text
}

/** Settings column: grouped lists read best narrow, like Apple's Settings. */
export const SETTINGS_COLUMN = 'flex flex-col gap-7 lg:max-w-[680px] lg:gap-6'
