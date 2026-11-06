import { formatMonthName } from '@/lib/format'

/** "November", or "November 2025" when it isn't this year. */
export function monthLabel(month: string, today: string): string {
  return month.slice(0, 4) === today.slice(0, 4)
    ? formatMonthName(month)
    : `${formatMonthName(month)} ${month.slice(0, 4)}`
}

/** `/budgets/:id`, keeping the month in the URL when one is chosen. */
export function categoryPath(id: string, month: string | undefined): string {
  return month ? `/budgets/${id}?month=${month}` : `/budgets/${id}`
}
