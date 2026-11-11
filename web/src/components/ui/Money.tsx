import { formatMoney, formatMoneyParts, formatOver, useRegion, type EntryKind } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface MoneyProps {
  /** Integer minor units (bani, cents). Expenses are positive; `kind` gives the direction. */
  minor: number
  /** ISO code: "RON", "EUR". */
  currency: string
  /** `income` → "+850,00 lei" in `text-positive`. Expenses never show a minus. */
  kind?: EntryKind
  /** Whole units for summaries: "2.000 lei". */
  whole?: boolean
  /** "≈ " prefix for totals that include converted amounts. */
  approx?: boolean
  /** "27,50 lei over" in `text-negative`. */
  over?: boolean
  /** Color the income amount green (default true). Turn off where the row color is fixed. */
  tone?: boolean
  className?: string
}

/**
 * The one place money is rendered (design § 6.7): region formatting, tabular
 * numerals, never wraps.
 *
 *   <Money minor={6430} currency="RON" />                    → 64,30 lei
 *   <Money minor={85000} currency="RON" kind="income" />     → +850,00 lei (green)
 *   <Money minor={2750} currency="RON" over />               → 27,50 lei over (red)
 *   <Money minor={388230} currency="RON" approx />           → ≈ 3.882,30 lei
 */
export function Money({ minor, currency, kind, whole, approx, over, tone = true, className }: MoneyProps) {
  const region = useRegion()
  const text = over
    ? formatOver(minor, currency, { region, whole, approx })
    : formatMoney(minor, currency, { region, kind, whole, approx })
  return (
    <span
      className={cn(
        'tabular-nums whitespace-nowrap',
        tone && kind === 'income' && 'text-positive',
        over && 'text-negative',
        className,
      )}
    >
      {text}
    </span>
  )
}

export interface HeroAmountProps {
  minor: number
  currency: string
  /** `display` (Home hero, 44/56) or `large-title` (summary cards). */
  size?: 'display' | 'large-title'
  /** Whole units ("26 %"-style cards pass a custom node instead). */
  whole?: boolean
  approx?: boolean
  className?: string
}

/**
 * Display amount in SF Rounded: decimals at 0.6em, currency at 0.45em in `label-2`
 * (design § 4.2). Screen readers get the plain formatted string.
 *
 *   <HeroAmount minor={76571} currency="RON" />   → 765,71 lei
 */
export function HeroAmount({ minor, currency, size = 'display', whole, approx, className }: HeroAmountProps) {
  const region = useRegion()
  const p = formatMoneyParts(minor, currency, { region, whole, approx })
  const symbol = <span className="ml-[0.15em] text-[0.45em] font-semibold tracking-normal text-label-2">{p.symbol}</span>
  return (
    <p
      className={cn(
        'm-0 font-rounded font-bold tracking-[-0.015em] tabular-nums whitespace-nowrap',
        size === 'display' ? 'text-display' : 'text-large-title',
        className,
      )}
    >
      <span className="sr-only">{p.text}</span>
      <span aria-hidden>
        {p.approx}
        {p.sign}
        {p.symbolPosition === 'before' && <span className="mr-[0.15em] text-[0.45em] font-semibold text-label-2">{p.symbol}</span>}
        {p.integer}
        {p.fraction && (
          <span className="text-[0.6em] tracking-normal">
            {p.decimalSeparator}
            {p.fraction}
          </span>
        )}
        {p.symbolPosition === 'after' && symbol}
      </span>
    </p>
  )
}
