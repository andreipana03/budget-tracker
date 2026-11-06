/**
 * Subscription copy (design § 8): "Monthly", "Every 2 weeks", "In 3 days · Sat 21 Nov".
 */
import type { components } from '@/lib/api/schema.gen'
import { daysBetween, formatWeekday } from '@/lib/format'

export type Frequency = components['schemas']['Frequency']
export type Subscription = components['schemas']['Subscription']

const UNIT: Record<Frequency, [string, string]> = {
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
}
const EVERY_ONE: Record<Frequency, string> = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }

/** "Monthly", "Weekly", "Yearly", "Every 2 weeks", "Every 3 months". */
export function repeatText(frequency: Frequency, intervalCount = 1): string {
  if (intervalCount <= 1) return EVERY_ONE[frequency]
  return `Every ${intervalCount} ${UNIT[frequency][1]}`
}

/** The interval picker's options: "1 month", "2 months"… */
export function intervalLabel(frequency: Frequency, n: number): string {
  return `${n} ${UNIT[frequency][n === 1 ? 0 : 1]}`
}

/** Sensible maximum interval per frequency for the picker. */
export function maxInterval(frequency: Frequency): number {
  return frequency === 'weekly' ? 8 : frequency === 'monthly' ? 12 : 5
}

/**
 * Who is due within the week, for the desktop summary card:
 * "Netflix on Saturday · Digi Mobile on Wednesday".
 */
export function dueSoonText(items: Pick<Subscription, 'title' | 'nextDueOn'>[], today: string, max = 2): string {
  if (items.length === 0) return 'Nothing due this week'
  const when = (day: string) => {
    const d = daysBetween(today, day)
    if (d <= 0) return 'today'
    if (d === 1) return 'tomorrow'
    return `on ${formatWeekday(day)}`
  }
  const shown = items.slice(0, max).map((s) => `${s.title} ${when(s.nextDueOn)}`)
  if (items.length > max) shown.push(`${items.length - max} more`)
  return shown.join(' · ')
}
