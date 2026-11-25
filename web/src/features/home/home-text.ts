import { formatMoney } from '@/lib/format'

/**
 * The hero's daily line (design § 3): "About 55 lei a day for the next 13 days" —
 * whole units, the API's perDayMinor (already rounded), singular on the last day.
 */
export function perDayText(perDayMinor: number, daysLeft: number, currency: string, region?: string | null): string {
  if (perDayMinor <= 0) {
    return daysLeft === 1
      ? 'Nothing left for flexible spending today'
      : `Nothing left for flexible spending for the next ${daysLeft} days`
  }
  const amount = formatMoney(perDayMinor, currency, { region, whole: true })
  return daysLeft === 1 ? `About ${amount} for today, the last day` : `About ${amount} a day for the next ${daysLeft} days`
}

/**
 * Footer under Home › Accounts: explains the ≈ total, and that accounts with
 * Include in Total off are left out. Nothing to explain → no footer.
 */
export function accountsFooter(data: {
  totalIsApproximate: boolean
  items: readonly { archived: boolean; includeInTotal: boolean }[]
}): string | undefined {
  const parts: string[] = []
  if (data.totalIsApproximate) parts.push('Other currencies are converted at today’s BNR rate.')
  if (data.items.some((a) => !a.archived && !a.includeInTotal)) parts.push('Accounts with Include in Total off aren’t counted.')
  return parts.length ? parts.join(' ') : undefined
}
