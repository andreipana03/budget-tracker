import { Link } from 'react-router'

import { formatMinorNumber, formatMoney, formatOver, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { CategoryTile } from './CategoryTile'
import { Icon } from './Icon'
import { rowClasses } from './row-classes'
import { MiniPace } from './PaceBar'

/** API BudgetStatus. */
export type BudgetStatus = 'over' | 'ahead' | 'on_track'

export interface BudgetRowProps {
  name: string
  /** Category hue and icon from the API. */
  color: string
  icon: string
  spentMinor: number
  /** null = no budget for this category this month. */
  limitMinor: number | null
  currency: string
  status: BudgetStatus
  /** Share of the period elapsed (API period.elapsed). Hidden for fixed categories. */
  elapsed?: number | null
  fixed?: boolean
  to?: string
  onClick?: () => void
  className?: string
}

/**
 * Budget row (design § 6.5, § 3): name + "353,60 lei left" (or "27,50 lei over"
 * in red), the mini pace bar, then the status note:
 *   over   → ⚠ Over budget · 327,50 of 300 lei   (red, semibold)
 *   ahead  → ↗ Ahead of pace · 169,90 of 250 lei (label, semibold — a nudge, no color)
 *   on track → 246,40 of 600 lei (· Fixed)
 */
export function BudgetRow({
  name,
  color,
  icon,
  spentMinor,
  limitMinor,
  currency,
  status,
  elapsed,
  fixed,
  to,
  onClick,
  className,
}: BudgetRowProps) {
  const region = useRegion()
  const hasLimit = limitMinor != null
  const left = hasLimit ? limitMinor - spentMinor : 0
  const isOver = hasLimit && (status === 'over' || left < 0)
  const ofText = hasLimit
    ? `${formatMinorNumber(spentMinor, currency, { region })} of ${formatMoney(limitMinor, currency, { region, whole: true })}`
    : `${formatMoney(spentMinor, currency, { region })} spent`

  const label = hasLimit
    ? `${name}: ${isOver ? `${formatMoney(-left, currency, { region })} over budget` : `${formatMoney(left, currency, { region })} left`}, ${formatMoney(spentMinor, currency, { region })} spent of ${formatMoney(limitMinor, currency, { region })}${status === 'ahead' ? ', ahead of pace' : ''}${fixed ? ', fixed' : ''}`
    : `${name}: no budget, ${formatMoney(spentMinor, currency, { region })} spent`

  const content = (
    <>
      <CategoryTile color={color} icon={icon} className="mt-px" />
      <span className="block min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2.5">
          <span className="truncate text-body">{name}</span>
          {hasLimit ? (
            isOver ? (
              <span className="text-subhead font-semibold whitespace-nowrap text-negative tabular-nums">
                {formatOver(left, currency, { region })}
              </span>
            ) : (
              <span className="text-subhead whitespace-nowrap text-label-2 tabular-nums">
                <strong className="font-semibold text-label">{formatMoney(left, currency, { region })}</strong> left
              </span>
            )
          ) : null}
        </span>
        <MiniPace spentMinor={spentMinor} limitMinor={limitMinor} elapsed={elapsed} fixed={fixed} color={color} />
        {isOver ? (
          <span className="mt-1.5 flex items-center gap-1 text-footnote font-semibold text-negative">
            <Icon name="warning-circle" weight="fill" className="text-[14px]" />
            Over budget · {ofText}
          </span>
        ) : status === 'ahead' && !fixed ? (
          <span className="mt-1.5 flex items-center gap-1 text-footnote font-semibold text-label">
            <Icon name="trend-up" className="text-[14px]" />
            Ahead of pace ·<span className="font-normal text-label-2">{ofText}</span>
          </span>
        ) : (
          <span className="mt-1.5 flex items-center gap-1 text-footnote text-label-2 tabular-nums">
            {hasLimit ? ofText : `No budget · ${ofText}`}
            {fixed && ' · Fixed'}
          </span>
        )}
      </span>
    </>
  )

  const classes = cn(rowClasses({ interactive: Boolean(to || onClick) }), 'items-start py-3 lg:py-3', className)
  if (to)
    return (
      <Link to={to} className={classes} aria-label={label}>
        {content}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" className={classes} onClick={onClick} aria-label={label}>
        {content}
      </button>
    )
  return (
    <div className={classes} role="group" aria-label={label}>
      {content}
    </div>
  )
}
