import { dayHeaderParts, formatMoney, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { DayGroup, EntryKind } from './transactions'

/**
 * Day group header: "Today · Wed 18 Nov" (older days "Monday, 16 November") and the
 * day's total from the API's dayTotals: "84,30 lei spent", or "850,00 lei received"
 * on an income-only day / the Income filter.
 */
export function DayHeading({
  group,
  today,
  kind,
  currency,
  className,
}: {
  group: DayGroup
  today: string
  kind?: EntryKind
  /** Home currency; defaults to the first item's. */
  currency?: string
  className?: string
}) {
  const region = useRegion()
  const { title, detail } = dayHeaderParts(group.date, today)
  const cur = currency ?? group.items[0]?.homeCurrency ?? 'RON'
  const showIncome = kind === 'income' || (group.expenseHomeMinor === 0 && group.incomeHomeMinor > 0)
  const total = showIncome
    ? group.incomeHomeMinor > 0
      ? `${formatMoney(group.incomeHomeMinor, cur, { region })} received`
      : null
    : group.expenseHomeMinor > 0
      ? `${formatMoney(group.expenseHomeMinor, cur, { region })} spent`
      : null
  return (
    <div role="presentation" className={cn('flex items-baseline justify-between gap-3', className)}>
      <h3 className="m-0 truncate text-headline">
        {title}
        {detail && <span className="font-normal text-label-2"> · {detail}</span>}
      </h3>
      {total && <span className="flex-none text-subhead whitespace-nowrap text-label-2 tabular-nums">{total}</span>}
    </div>
  )
}
