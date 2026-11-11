import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { formatInteger, formatMoney, roundMinorToWhole, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface BarChartBar {
  /** X label: "Nov", "Mon", "18". */
  label: string
  /** Longer name for the screen-reader sentence: "November". Defaults to `label`. */
  name?: string
  spentMinor: number
  /** The bar containing today: drawn in tint, value label above it. */
  current?: boolean
  /** Projection for the current bar (dashed tint outline over tint-soft). */
  projectedMinor?: number | null
}

export interface BarChartProps {
  bars: BarChartBar[]
  currency: string
  /** Dashed `label-2` rule labeled "Avg 1.987". */
  averageMinor?: number | null
  /** Start of the screen-reader sentence: "Monthly spending, June to November 2026." */
  description: string
  className?: string
}

/** Pick a "nice" step (1, 2, 2.5, 5 × 10ⁿ) closest to `raw` in log space. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const base = 10 ** exp
  const candidates = [1, 2, 2.5, 5, 10].map((c) => c * base)
  return candidates.reduce((best, c) => (Math.abs(Math.log(c / raw)) < Math.abs(Math.log(best / raw)) ? c : best))
}

function barPath(x: number, top: number, bottom: number, w: number, r: number) {
  const h = bottom - top
  const rr = Math.max(0, Math.min(r, h, w / 2))
  return `M${x},${bottom} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${bottom} Z`
}

/**
 * Spending bar chart — an SVG port of the prototype chart (design § 6.14).
 * Past bars `chart-neutral`, the current bar `tint` with its value above, the
 * projection as a dashed outline over `tint-soft`, an "Avg" dashed rule, y-axis
 * labels on the trailing side (≤ 3 gridlines). Width follows the container.
 * `role="img"` with a label that reads every value; pair it with a headline
 * stating the takeaway.
 *
 *   <BarChart currency="RON" averageMinor={198700} description="Monthly spending, June to November 2026."
 *     bars={[{ label: 'Jun', name: 'June', spentMinor: 181200 }, …, { label: 'Nov', spentMinor: 123429, current: true, projectedMinor: 197000 }]} />
 */
export function BarChart({ bars, currency, averageMinor, description, className }: BarChartProps) {
  const region = useRegion()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const whole = (m: number) => roundMinorToWhole(m, currency)
  const label =
    `${description} ` +
    bars
      .map((b) => {
        const name = b.name ?? b.label
        const spent = formatMoney(b.spentMinor, currency, { region, whole: true })
        return b.current && b.projectedMinor != null
          ? `${name} ${spent} so far, projected ${formatMoney(b.projectedMinor, currency, { region, whole: true })}`
          : `${name} ${spent}`
      })
      .join(', ') +
    '.' +
    (averageMinor != null ? ` Average ${formatMoney(averageMinor, currency, { region, whole: true })}.` : '')

  const w = width || 320
  const compact = w < 520
  const H = compact ? 196 : 250
  const padT = 26
  const padB = 24
  const padR = 40
  const plotW = w - padR
  const plotH = H - padT - padB

  const values = bars.flatMap((b) => [whole(b.spentMinor), b.projectedMinor != null ? whole(b.projectedMinor) : 0])
  if (averageMinor != null) values.push(whole(averageMinor))
  const maxVal = Math.max(...values, 1)
  const step = niceStep(maxVal / 2.4)
  const yMax = Math.max(maxVal * 1.05, step)
  const ticks = [0, step, step * 2].filter((t) => t <= yMax)
  const y = (v: number) => padT + plotH - (v / yMax) * plotH

  const slot = plotW / Math.max(bars.length, 1)
  const bw = Math.min(slot * 0.56, 46)
  const r = 6
  const labelEvery = slot < 26 ? Math.ceil(26 / slot) : 1
  const avg = averageMinor != null ? whole(averageMinor) : null

  return (
    <div ref={ref} className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${w} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={label}
        className="block overflow-visible font-sans"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--separator)" strokeWidth={t === 0 ? 1 : 0.5} />
            <text x={plotW + 8} y={y(t) + 4} fontSize={11} fill="var(--label-2)">
              {formatInteger(t, { region })}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = i * slot + (slot - bw) / 2
          const v = whole(b.spentMinor)
          const showLabel = b.current || i % labelEvery === 0
          return (
            <g key={`${b.label}-${i}`}>
              <title>{`${b.name ?? b.label}: ${formatMoney(b.spentMinor, currency, { region })}`}</title>
              {b.current && b.projectedMinor != null && whole(b.projectedMinor) > v && (
                <path
                  d={barPath(x + 0.75, y(whole(b.projectedMinor)) + 0.75, y(0), bw - 1.5, r)}
                  fill="var(--tint-soft)"
                  stroke="var(--tint)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              )}
              {v > 0 && (
                <path
                  className="ui-grow-y"
                  style={{ animationDelay: `${i * 40}ms` }}
                  d={barPath(x, y(v), y(0), bw, r)}
                  fill={b.current ? 'var(--tint)' : 'var(--chart-neutral)'}
                />
              )}
              {b.current && (
                <text
                  x={x + bw / 2}
                  y={y(v) - 7}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="var(--tint-text)"
                >
                  {formatInteger(v, { region })}
                </text>
              )}
              {showLabel && (
                <text
                  x={x + bw / 2}
                  y={H - 4}
                  textAnchor="middle"
                  fontSize={compact ? 12 : 11}
                  fontWeight={b.current ? 600 : 400}
                  fill={b.current ? 'var(--label)' : 'var(--label-2)'}
                >
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
        {avg != null && (
          <g>
            <line x1={0} x2={plotW} y1={y(avg)} y2={y(avg)} stroke="var(--label-2)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text
              x={2}
              y={y(avg) - 7}
              fontSize={11}
              fontWeight={600}
              fill="var(--label)"
              paintOrder="stroke"
              stroke="var(--surface)"
              strokeWidth={4}
              strokeLinejoin="round"
            >
              Avg {formatInteger(avg, { region })}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

/**
 * Legend under the chart (`text-footnote`), decorative — the chart label already
 * reads every value.
 */
export function ChartLegend({
  items = ['spent', 'projected', 'past', 'average'],
  pastLabel = 'Past months',
  className,
}: {
  items?: ('spent' | 'projected' | 'past' | 'average')[]
  /** "Past months", "Past days", "Past weeks". */
  pastLabel?: string
  className?: string
}) {
  const swatch: Record<string, { label: string; el: ReactNode }> = {
    spent: { label: 'Spent so far', el: <i className="inline-block size-2.5 rounded-[3px] bg-tint" /> },
    projected: {
      label: 'Projected',
      el: <i className="inline-block size-2.5 rounded-[3px] border-[1.5px] border-dashed border-tint bg-tint-soft" />,
    },
    past: { label: pastLabel, el: <i className="inline-block size-2.5 rounded-[3px] bg-chart-neutral" /> },
    average: { label: 'Average', el: <i className="inline-block h-0 w-3.5 border-t-2 border-dashed border-label-2" /> },
  }
  return (
    <div aria-hidden className={cn('flex flex-wrap gap-4 pt-2.5 text-footnote text-label-2', className)}>
      {items.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          {swatch[k].el}
          {swatch[k].label}
        </span>
      ))}
    </div>
  )
}
