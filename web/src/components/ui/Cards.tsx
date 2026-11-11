import type { ReactNode } from 'react'

import { hueVar } from '@/lib/categories'
import { formatMoneyParts, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Icon, type IconName } from './Icon'
import { Card } from './List'

export interface StatItem {
  /** "Budget", "Spent", "Left" */
  label: string
  minor: number
  currency: string
  approx?: boolean
}

/**
 * Three stat columns (design § 6.15): label footnote semibold `label-2`, value in
 * SF Rounded whole units with the currency at 0.7em. Place inside a Card.
 *
 *   <StatCards items={[{ label: 'Budget', minor: 200000, currency: 'RON' }, …]} />
 */
export function StatCards({ items, className }: { items: StatItem[]; className?: string }) {
  const region = useRegion()
  return (
    <dl className={cn('m-0 grid grid-cols-3 gap-2', className)}>
      {items.map((it) => {
        const p = formatMoneyParts(it.minor, it.currency, { region, whole: true, approx: it.approx })
        return (
          <div key={it.label} className="min-w-0">
            <dt className="text-footnote font-semibold text-label-2">{it.label}</dt>
            <dd className="m-0 mt-0.5 font-rounded text-title-3 font-bold tracking-[-0.01em] whitespace-nowrap tabular-nums lg:text-title-1">
              <span className="sr-only">{p.text}</span>
              <span aria-hidden>
                {p.approx}
                {p.sign}
                {p.symbolPosition === 'before' && <span className="text-[0.7em] font-semibold text-label-2">{p.symbol} </span>}
                {p.integer}
                {p.symbolPosition === 'after' && <span className="text-[0.7em] font-semibold text-label-2"> {p.symbol}</span>}
              </span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export interface SparkBarsProps {
  /** Any non-negative numbers (scaled to the largest). */
  values: number[]
  /** Index of the bar to emphasize. */
  highlight?: number
  /** Category hue for the highlighted bar; default `label`. */
  color?: string
  className?: string
}

/** 36px spark bars: past bars `chart-neutral` at 55%, the highlighted one in color. Decorative. */
export function SparkBars({ values, highlight, color, className }: SparkBarsProps) {
  const max = Math.max(...values, 1)
  return (
    <div aria-hidden className={cn('mt-3 flex h-9 items-end gap-1', className)}>
      {values.map((v, i) => (
        <i
          key={i}
          className={cn('block flex-1 rounded-[3px_3px_1px_1px]', i === highlight ? 'opacity-100' : 'bg-chart-neutral opacity-55')}
          style={{
            height: `${Math.max((v / max) * 100, 4)}%`,
            background: i === highlight ? (color ? hueVar(color) : 'var(--label)') : undefined,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Insight highlight card (design § 6.15): kicker (icon + topic), headline, one
 * sentence, optional spark bars or action.
 *
 *   <HighlightCard kicker={{ icon: 'fork-knife', label: 'Eating Out', color: 'orange' }}
 *     title="Up 32% from October" body="327,50 lei so far, against 248 lei by this point last month."
 *     spark={{ values: [210, 260, 180, 240, 248, 327.5], highlight: 5, color: 'orange' }} />
 */
export function HighlightCard({
  kicker,
  title,
  body,
  spark,
  children,
  className,
}: {
  kicker: { icon: IconName | (string & {}); label: string; color?: string }
  title: ReactNode
  body?: ReactNode
  spark?: SparkBarsProps
  /** Extra content under the body, e.g. a plain "View Subscriptions" button. */
  children?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('p-4 lg:p-4', className)}>
      <article>
        <p className="m-0 flex items-center gap-1.5 text-footnote font-semibold text-label-2">
          <span style={kicker.color ? { color: hueVar(kicker.color) } : undefined}>
            <Icon name={kicker.icon} variant="tile" className="text-[15px]" />
          </span>
          {kicker.label}
        </p>
        <p className="m-0 mt-1.5 text-headline">{title}</p>
        {body && <p className="m-0 mt-0.5 text-subhead text-label-2">{body}</p>}
        {spark && <SparkBars {...spark} />}
        {children}
      </article>
    </Card>
  )
}

/**
 * Horizontal category bar (Insights › By Category): 6px track, fill in the hue,
 * grows in once. Decorative — the row states the amount and percentage.
 */
export function HorizontalBar({ ratio, color, className }: { ratio: number; color: string; className?: string }) {
  const w = Math.min(Math.max(ratio, 0), 1)
  return (
    <span aria-hidden className={cn('mt-[7px] block h-1.5 overflow-hidden rounded-full bg-chart-track', className)}>
      {w > 0 && <i className="ui-grow-x block h-full rounded-full" style={{ width: `${w * 100}%`, background: hueVar(color) }} />}
    </span>
  )
}
