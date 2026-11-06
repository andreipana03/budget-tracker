import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { hueVar } from '@/lib/categories'
import { formatMinorNumber, formatMoney, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ---------- Grow-in once per screen per page load (design § 3 Motion) ----------
   Bars grow from the leading edge on a screen's FIRST appearance only — never again on
   re-render, refetch, month switch or tab switch. A bar opts in with an `animationKey`
   (or inherits one from <PaceAnimationScope>); once any bar with that key has mounted,
   later mounts with the same key render without the animation. Without a key the bar
   keeps the old behaviour (grows on every mount). */
const grownKeys = new Set<string>()
const PaceAnimationContext = createContext<string | null>(null)

/**
 * Gives every PaceBar / MiniPace inside (e.g. BudgetRows) the same animation key, so a
 * whole screen grows in once per page load.
 *
 *   <PaceAnimationScope id="home">…</PaceAnimationScope>
 */
export function PaceAnimationScope({ id, children }: { id: string; children: ReactNode }) {
  return <PaceAnimationContext.Provider value={id}>{children}</PaceAnimationContext.Provider>
}

/** True when this mount should play the grow-in animation. */
function useGrowOnce(animationKey?: string): boolean {
  const scoped = useContext(PaceAnimationContext)
  const key = animationKey ?? scoped
  const [grow] = useState(() => key == null || !grownKeys.has(key))
  useEffect(() => {
    if (key != null) grownKeys.add(key)
  }, [key])
  return grow
}

export interface PaceSegmentInput {
  /** Category hue (`mint`, …). */
  color: string
  /** min(spent, limit) for the category, minor units (API PaceSegment.amountMinor). */
  amountMinor: number
  /** Category name — used by the legend. */
  name?: string
}

export interface PaceBarProps {
  /** Fixed categories first, then flexible in budget order (the API sends them in this order). */
  segments: PaceSegmentInput[]
  spentMinor: number
  budgetMinor: number
  currency: string
  /** Where the "Today" tick sits, 0–1 (API totals.paceMarker). `null` hides it (past/future month). */
  marker?: number | null
  /** Desktop-only legend of category dots with whole amounts. Items: name + color + spent. */
  legend?: { name: string; color: string; spentMinor: number }[]
  /**
   * Grow in only the first time a bar with this key mounts in this page load (e.g. "home",
   * "budgets"). Omit to grow on every mount. A surrounding <PaceAnimationScope> also sets it.
   */
  animationKey?: string
  className?: string
}

/**
 * The signature pace bar (design § 3). Segments in category colors, a gray rest,
 * the "Today" tick and the scale line. Grows in once per mount (off under Reduce
 * Motion). Read as one sentence by screen readers.
 *
 *   <PaceBar segments={home.segments.map(s => ({ color: s.category.color, amountMinor: s.amountMinor }))}
 *            spentMinor={t.spentMinor} budgetMinor={t.budgetMinor} currency="RON" marker={t.paceMarker} />
 */
export function PaceBar({ segments, spentMinor, budgetMinor, currency, marker, legend, animationKey, className }: PaceBarProps) {
  const region = useRegion()
  const grow = useGrowOnce(animationKey)
  const total = Math.max(budgetMinor, 1)
  const evenMinor = marker == null ? null : Math.round(marker * budgetMinor)
  const label =
    `Spent ${formatMoney(spentMinor, currency, { region })} of ${formatMoney(budgetMinor, currency, { region })}.` +
    (evenMinor == null
      ? ''
      : ` If you spent evenly you'd be at ${formatMoney(evenMinor, currency, { region, whole: true })} today.`)

  return (
    <div className={className}>
      <div className="relative pt-[18px]" role="img" aria-label={label}>
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full lg:h-[18px]">
          {segments
            .filter((s) => s.amountMinor > 0)
            .map((s, i) => (
              <span
                key={`${s.color}-${i}`}
                className={cn('h-full min-w-0.5', grow && 'ui-grow-x')}
                style={{
                  width: `${(Math.min(s.amountMinor, total) / total) * 100}%`,
                  background: hueVar(s.color),
                  animationDelay: `${i * 40}ms`,
                }}
              />
            ))}
          <span className="h-full min-w-0 flex-1 bg-chart-track" />
        </div>
        {marker != null && (
          <span
            className="absolute top-3.5 -ml-px h-[22px] w-0.5 rounded-[1px] bg-marker shadow-[0_0_0_1.5px_var(--surface)] lg:h-[26px]"
            style={{ left: `${Math.min(Math.max(marker, 0), 1) * 100}%` }}
          >
            <span className="absolute bottom-[calc(100%+1px)] left-1/2 -translate-x-1/2 text-caption-2 leading-none font-semibold whitespace-nowrap text-label-2">
              Today
            </span>
          </span>
        )}
      </div>
      <div aria-hidden className="mt-2 flex justify-between gap-3 text-footnote text-label-2 tabular-nums">
        <span>
          <strong className="font-semibold text-label">{formatMoney(spentMinor, currency, { region })}</strong> spent
        </span>
        <span>{formatMoney(budgetMinor, currency, { region, whole: true })} budget</span>
      </div>
      {legend && legend.length > 0 && <PaceLegend items={legend} currency={currency} className="hidden lg:flex" />}
    </div>
  )
}

/** Category dots with whole amounts ("Groceries 246"), shown under the desktop hero bar. */
export function PaceLegend({
  items,
  currency,
  className,
}: {
  items: { name: string; color: string; spentMinor: number }[]
  currency: string
  className?: string
}) {
  const region = useRegion()
  return (
    <div aria-hidden className={cn('mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-callout text-label-2', className)}>
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <i className="inline-block size-[9px] rounded-[3px]" style={{ background: hueVar(it.color) }} />
          {it.name}
          <b className="font-medium text-label tabular-nums">{formatMinorNumber(it.spentMinor, currency, { region, whole: true })}</b>
        </span>
      ))}
    </div>
  )
}

export interface MiniPaceProps {
  spentMinor: number
  /** The category's limit; with no limit the bar is empty. */
  limitMinor: number | null
  /** Share of the period elapsed, 0–1 (API period.elapsed). The tick; hidden for fixed categories. */
  elapsed?: number | null
  fixed?: boolean
  /** Category hue. */
  color: string
  /** See PaceBarProps.animationKey. */
  animationKey?: string
  className?: string
}

/**
 * The mini pace bar inside budget rows (design § 3 anatomy): 6px track (8px on
 * desktop), fill in the category color, tick at `elapsed` for flexible categories.
 * Decorative: the row's text carries the numbers.
 */
export function MiniPace({ spentMinor, limitMinor, elapsed, fixed, color, animationKey, className }: MiniPaceProps) {
  const grow = useGrowOnce(animationKey)
  const used = limitMinor && limitMinor > 0 ? Math.min(spentMinor / limitMinor, 1) : 0
  return (
    <div aria-hidden className={cn('relative mt-[7px] h-1.5 lg:h-2', className)}>
      <div className="h-full overflow-hidden rounded-full bg-chart-track">
        {used > 0 && (
          <div className={cn('h-full rounded-full', grow && 'ui-grow-x')} style={{ width: `${used * 100}%`, background: hueVar(color) }} />
        )}
      </div>
      {!fixed && elapsed != null && (
        <span
          className="absolute -top-[3px] -ml-px h-3 w-0.5 rounded-[1px] bg-marker shadow-[0_0_0_1.5px_var(--surface)] lg:h-3.5"
          style={{ left: `${Math.min(Math.max(elapsed, 0), 1) * 100}%` }}
        />
      )}
    </div>
  )
}
