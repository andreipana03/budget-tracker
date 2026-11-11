import type { ReactNode } from 'react'

import { ButtonLink, Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/List'
import { Icon } from '@/components/ui/Icon'
import { HeroAmount } from '@/components/ui/Money'
import { PaceBar } from '@/components/ui/PaceBar'
import { SkeletonBlock } from '@/components/ui/States'
import { addMonths, formatMoney, formatMonthName, formatShortDate, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useCategories } from '@/lib/api/queries'

import { perDayText } from './home-text'

import type { BudgetMonth } from './useHome'

const LABEL = 'm-0 text-subhead font-semibold text-label-2'
const SUB = 'm-0 mt-1 text-subhead text-label-2'

/**
 * Home hero card (design § 6.15, § 3): what's left, the daily amount, the pace status
 * and the pace bar — or the no-budget, month-over and not-started-yet versions.
 */
export function HomeHero({
  budget,
  currentMonth,
  onGoToCurrent,
}: {
  budget: BudgetMonth
  /** The household's current budget month, 'YYYY-MM'. */
  currentMonth: string
  onGoToCurrent: () => void
}) {
  const region = useRegion()
  const categories = useCategories()
  const { period, totals, homeCurrency: cur } = budget
  const order = new Map((categories.data ?? []).map((c, i) => [c.id, i]))
  const name = formatMonthName(period.month)

  const paceBar = (marker: number | null) => (
    <PaceBar
      animationKey="home"
      className="mt-3.5 lg:mt-[22px]"
      segments={budget.segments.map((s) => ({ color: s.category.color, amountMinor: s.amountMinor, name: s.category.name }))}
      spentMinor={totals.spentMinor}
      budgetMinor={totals.budgetMinor}
      currency={cur}
      marker={marker}
      legend={budget.segments
        .slice()
        .sort((a, b) => (order.get(a.category.id) ?? 99) - (order.get(b.category.id) ?? 99))
        .map((s) => ({ name: s.category.name, color: s.category.color, spentMinor: legendSpent(budget, s.category.id) }))}
    />
  )

  // No budget this month: say how to get one; no pace bar.
  if (!budget.hasBudget) {
    return (
      <HeroCard>
        <p className={LABEL}>{name}</p>
        <p className="m-0 mt-1 text-title-3 font-semibold lg:text-title-2">Set a monthly budget to see what’s left</p>
        <p className={SUB}>Give each category a limit and Budget Tracker shows how much you can still spend each day.</p>
        <ButtonLink to="/budgets?edit=1" variant="prominent" icon="plus" className="mt-4">
          Set Budget
        </ButtonLink>
      </HeroCard>
    )
  }

  // A month that has ended.
  if (period.state === 'past') {
    const left = totals.leftMinor
    const next = addMonths(period.month, 1)
    return (
      <HeroCard>
        <p className={LABEL}>{name} is over</p>
        <HeroAmount minor={totals.spentMinor} currency={cur} className="mt-0.5" />
        <p className={SUB}>
          Spent of your {formatMoney(totals.budgetMinor, cur, { region, whole: true })} budget ·{' '}
          {left >= 0 ? (
            `${formatMoney(left, cur, { region })} left over`
          ) : (
            <span className="font-semibold text-negative">{formatMoney(-left, cur, { region })} over</span>
          )}
        </p>
        {paceBar(null)}
        <Button variant="prominent" onClick={onGoToCurrent} className="mt-5">
          {next === currentMonth ? `Start ${formatMonthName(currentMonth)}` : `Go to ${formatMonthName(currentMonth)}`}
        </Button>
      </HeroCard>
    )
  }

  // A month that hasn't started.
  if (period.state === 'future') {
    return (
      <HeroCard>
        <p className={LABEL}>Budget for {name}</p>
        <HeroAmount minor={totals.budgetMinor} currency={cur} className="mt-0.5" />
        <p className={SUB}>
          Starts {formatShortDate(period.startsOn, period.today)} · {period.daysInPeriod} days
        </p>
        <Button variant="secondary" onClick={onGoToCurrent} className="mt-4">
          Go to {formatMonthName(currentMonth)}
        </Button>
      </HeroCard>
    )
  }

  const over = totals.status === 'over'
  const status = over ? (
    <p className="m-0 mt-3.5 inline-flex items-center gap-1.5 text-subhead font-semibold text-negative lg:mt-1.5">
      <Icon name="warning-circle" weight="fill" className="text-[18px]" />
      Over budget{' '}
      <span className="font-normal">· {formatMoney(-totals.leftMinor, cur, { region, whole: true })} over</span>
    </p>
  ) : totals.status === 'ahead' ? (
    <p className="m-0 mt-3.5 inline-flex items-center gap-1.5 text-subhead font-semibold text-label lg:mt-1.5">
      <Icon name="trend-up" className="text-[18px]" />
      Ahead of pace{' '}
      <span className="font-normal text-label-2">
        · {formatMoney(-(totals.underPaceMinor ?? 0), cur, { region, whole: true })} over
      </span>
    </p>
  ) : (
    <p className="m-0 mt-3.5 inline-flex items-center gap-1.5 text-subhead font-semibold lg:mt-1.5">
      <Icon name="check-circle" weight="fill" className="text-[18px] text-positive" />
      On track{' '}
      <span className="font-normal text-label-2">
        · {formatMoney(totals.underPaceMinor ?? 0, cur, { region, whole: true })} under pace
      </span>
    </p>
  )

  return (
    <HeroCard>
      <div className="lg:flex lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0">
          <p className={LABEL}>{over ? `Over budget in ${name}` : `Left to spend in ${name}`}</p>
          <HeroAmount minor={Math.abs(totals.leftMinor)} currency={cur} className={cn('mt-0.5', over && 'text-negative')} />
          {totals.perDayMinor != null && (
            <p className={SUB}>{perDayText(totals.perDayMinor, period.daysLeft, cur, region)}</p>
          )}
        </div>
        {status}
      </div>
      {paceBar(totals.paceMarker)}
    </HeroCard>
  )
}

/** What a category spent this month, for the legend (segments are capped at the limit). */
function legendSpent(budget: BudgetMonth, categoryId: string): number {
  const line = [...budget.fixed, ...budget.flexible].find((l) => l.category.id === categoryId)
  return line?.spentMinor ?? budget.segments.find((s) => s.category.id === categoryId)?.amountMinor ?? 0
}

function HeroCard({ children }: { children: ReactNode }) {
  return (
    <Card padded className="h-full lg:px-[26px] lg:py-6">
      {children}
    </Card>
  )
}

/** Loading shape of the hero: label, amount, daily line, status, bar and scale. */
export function HomeHeroSkeleton() {
  return (
    <Card padded className="h-full lg:px-[26px] lg:py-6" aria-busy>
      <span className="sr-only" role="status">
        Loading…
      </span>
      <SkeletonBlock className="h-3.5 w-44" />
      <SkeletonBlock className="mt-3 h-11 w-48 rounded-sm lg:h-14" />
      <SkeletonBlock className="mt-3 h-3.5 w-64 max-w-full" />
      <SkeletonBlock className="mt-4 h-4 w-48 lg:hidden" />
      <SkeletonBlock className="mt-7 h-3.5 w-full rounded-full lg:mt-10 lg:h-[18px]" />
      <div className="mt-2.5 flex justify-between">
        <SkeletonBlock className="h-3 w-28" />
        <SkeletonBlock className="h-3 w-24" />
      </div>
    </Card>
  )
}
