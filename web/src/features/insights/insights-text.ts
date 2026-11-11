/**
 * Insights copy and chart shaping (design § 6.14, § 8): facts only, no judgment,
 * no exclamation marks. Pure functions so every branch is unit-tested.
 */
import type { BarChartBar } from '@/components/ui'
import type { components } from '@/lib/api/schema.gen'
import {
  addDays,
  daysBetween,
  formatLongDate,
  formatMoney,
  formatMonthName,
  formatMonthShort,
  formatMonthYear,
  formatWeekday,
  WEEKDAY_LABELS_MONDAY_FIRST,
  weekdayIndexMondayFirst,
} from '@/lib/format'

export type Insights = components['schemas']['Insights']
export type InsightsPeriod = components['schemas']['InsightsPeriod']
export type InsightsHeadline = components['schemas']['InsightsHeadline']
export type InsightsBar = components['schemas']['InsightsBar']
export type BiggestChange = components['schemas']['BiggestChange']
export type BiggestDay = components['schemas']['BiggestDay']
export type SubscriptionsHighlight = components['schemas']['SubscriptionsHighlight']

export const PERIOD_OPTIONS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'six_months', label: '6 Months' },
  { value: 'year', label: 'Year' },
] as const satisfies readonly { value: InsightsPeriod; label: string }[]

export function isInsightsPeriod(v: string | null | undefined): v is InsightsPeriod {
  return PERIOD_OPTIONS.some((o) => o.value === v)
}

/** Below this the change reads as "About the same". */
const SAME_THRESHOLD = 0.01

interface TextOpts {
  region?: string | null
}

/** "18 Oct" */
export function formatDayMonth(day: string): string {
  return `${Number(day.slice(8, 10))} ${formatMonthShort(day)}`
}

/** What the comparison unit is called: "last week" or "October". */
function comparedName(period: InsightsPeriod, comparedTo: string): { inPhrase: string; fromPhrase: string } {
  if (period === 'week') return { inPhrase: 'last week', fromPhrase: 'last week' }
  const month = formatMonthName(comparedTo)
  return { inPhrase: `in ${month}`, fromPhrase: month }
}

/**
 * The chart headline: the takeaway in one sentence.
 *   "You’ve spent 8% less than at this point in October."
 *   "You’ve spent 12% more than at this point last week."
 *   "About the same as at this point in October."          (|change| < 1%)
 *   "You’ve spent 1.234 lei so far."                        (no previous data)
 */
export function headlineSentence(
  period: InsightsPeriod,
  headline: InsightsHeadline,
  currency: string,
  opts: TextOpts = {},
): string {
  const { changeRatio, previousMinor, comparedTo, currentMinor } = headline
  if (changeRatio == null || previousMinor == null) {
    return `You’ve spent ${formatMoney(currentMinor, currency, { region: opts.region, whole: true })} so far.`
  }
  const { inPhrase } = comparedName(period, comparedTo)
  const point = `at this point ${inPhrase}`
  if (Math.abs(changeRatio) < SAME_THRESHOLD) return `About the same as ${point}.`
  const pct = Math.max(1, Math.round(Math.abs(changeRatio) * 100))
  return `You’ve spent ${pct}% ${changeRatio < 0 ? 'less' : 'more'} than ${point}.`
}

/** First day of the unit the headline measures (the week or budget month containing today). */
export function currentUnitStart(insights: Pick<Insights, 'period' | 'startsOn' | 'bars'>): string {
  if (insights.period === 'week' || insights.period === 'month') return insights.startsOn
  return insights.bars.find((b) => b.isCurrent)?.startsOn ?? insights.startsOn
}

/**
 * The supporting numbers under the headline.
 *   6 Months / Year: "On pace for about 1.970 lei · your average month is 1.987 lei"
 *   Week / Month (or without projection/average): "1.234 lei so far · 1.342 lei by 18 Oct"
 */
export function supportingLine(insights: Insights, today: string, opts: TextOpts = {}): string {
  const cur = insights.homeCurrency
  const whole = (m: number) => formatMoney(m, cur, { region: opts.region, whole: true })
  const monthly = insights.period === 'six_months' || insights.period === 'year'
  if (monthly) {
    const projected = insights.bars.find((b) => b.isCurrent)?.projectedMinor ?? null
    const parts: string[] = []
    if (projected != null) parts.push(`On pace for about ${whole(projected)}`)
    if (insights.averageMinor != null)
      parts.push(`${parts.length ? 'your' : 'Your'} average month is ${whole(insights.averageMinor)}`)
    if (parts.length) return parts.join(' · ')
  }
  const { headline } = insights
  const parts = [`${whole(headline.currentMinor)} so far`]
  if (headline.previousMinor != null) {
    const offset = Math.max(0, daysBetween(currentUnitStart(insights), today))
    parts.push(`${whole(headline.previousMinor)} by ${formatDayMonth(addDays(headline.comparedTo, offset))}`)
  }
  return parts.join(' · ')
}

/**
 * Bars for <BarChart>, labelled per period:
 *   week → "Mon"…"Sun" · month → day numbers "1"…"30" ·
 *   six_months → "Jun"…"Nov" · year → "J F M …" when compact, else "Jan"…"Dec".
 */
export function chartBars(
  period: InsightsPeriod,
  bars: InsightsBar[],
  opts: { compact?: boolean } = {},
): BarChartBar[] {
  return bars.map((b) => {
    let label: string
    let name: string
    switch (period) {
      case 'week':
        label = WEEKDAY_LABELS_MONDAY_FIRST[weekdayIndexMondayFirst(b.startsOn)]
        name = formatLongDate(b.startsOn)
        break
      case 'month':
        label = String(Number(b.startsOn.slice(8, 10)))
        name = formatDayMonth(b.startsOn)
        break
      case 'six_months':
        label = formatMonthShort(b.startsOn)
        name = formatMonthYear(b.startsOn)
        break
      case 'year':
        label = opts.compact ? formatMonthShort(b.startsOn).slice(0, 1) : formatMonthShort(b.startsOn)
        name = formatMonthYear(b.startsOn)
        break
    }
    return {
      label,
      name,
      spentMinor: b.spentMinor,
      current: b.isCurrent,
      projectedMinor: b.isCurrent ? b.projectedMinor : null,
    }
  })
}

/** Opening of the chart's screen-reader sentence. */
export function chartDescription(period: InsightsPeriod, bars: InsightsBar[]): string {
  if (bars.length === 0) return 'Spending.'
  const first = bars[0].startsOn
  const last = bars[bars.length - 1].startsOn
  switch (period) {
    case 'week':
      return `Daily spending, week of ${formatDayMonth(first)}.`
    case 'month':
      return `Daily spending, ${formatDayMonth(first)} to ${formatDayMonth(last)}.`
    default:
      return `Monthly spending, ${formatMonthName(first)}${first.slice(0, 4) !== last.slice(0, 4) ? ` ${first.slice(0, 4)}` : ''} to ${formatMonthYear(last)}.`
  }
}

/** "Up 32% from October" / "Down 12% from last week" */
export function changeTitle(period: InsightsPeriod, change: Pick<BiggestChange, 'changeRatio' | 'comparedTo'>): string {
  const pct = Math.max(1, Math.round(Math.abs(change.changeRatio) * 100))
  return `${change.changeRatio < 0 ? 'Down' : 'Up'} ${pct}% from ${comparedName(period, change.comparedTo).fromPhrase}`
}

/** "327,50 lei so far, against 248 lei by this point last month." */
export function changeBody(
  period: InsightsPeriod,
  change: BiggestChange,
  currency: string,
  opts: TextOpts = {},
): string {
  const unit = period === 'week' ? 'last week' : 'last month'
  return `${formatMoney(change.currentMinor, currency, { region: opts.region })} so far, against ${formatMoney(change.previousMinor, currency, { region: opts.region, whole: true })} by this point ${unit}.`
}

/** "Friday, 13 November" (with the year when it isn't this year). */
export function biggestDayTitle(day: BiggestDay, today: string): string {
  const base = formatLongDate(day.date)
  return day.date.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${day.date.slice(0, 4)}`
}

/** "214,60 lei, mostly Shopping and Eating Out." */
export function biggestDayBody(day: BiggestDay, currency: string, opts: TextOpts = {}): string {
  const amount = formatMoney(day.spentMinor, currency, { region: opts.region })
  const names = day.topCategories.map((c) => c.name)
  return names.length ? `${amount}, mostly ${names.join(' and ')}.` : `${amount}.`
}

/** When something repeats next, relative to today: "today", "tomorrow", "on Saturday", "on 2 Dec". */
export function renewsWhen(nextDueOn: string, today: string): string {
  const d = daysBetween(today, nextDueOn)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d < 7) return `on ${formatWeekday(nextDueOn)}`
  return `on ${formatDayMonth(nextDueOn)}`
}

/** "≈ 162,87 lei a month" */
export function subscriptionsTitle(s: SubscriptionsHighlight, currency: string, opts: TextOpts = {}): string {
  return `${formatMoney(s.perMonthMinor, currency, { region: opts.region, approx: s.isApproximate })} a month`
}

/** "6 active · Netflix renews on Saturday." */
export function subscriptionsBody(s: SubscriptionsHighlight, today: string): string {
  const parts = [`${s.activeCount} active`]
  if (s.next)
    parts.push(
      `${s.next.title} ${s.next.kind === 'income' ? 'arrives' : 'renews'} ${renewsWhen(s.next.nextDueOn, today)}`,
    )
  return `${parts.join(' · ')}.`
}

/** True when there's nothing to show yet (no spending in the range at all). */
export function isEmptyInsights(insights: Insights): boolean {
  return insights.byCategory.length === 0 && insights.bars.every((b) => b.spentMinor === 0)
}

/** Text for the Share button: the headline plus the supporting numbers. */
export function shareText(insights: Insights, today: string, opts: TextOpts = {}): string {
  const label = PERIOD_OPTIONS.find((o) => o.value === insights.period)?.label ?? ''
  return [
    `Budget Tracker · ${label}`,
    headlineSentence(insights.period, insights.headline, insights.homeCurrency, opts),
    supportingLine(insights, today, opts),
  ].join('\n')
}
