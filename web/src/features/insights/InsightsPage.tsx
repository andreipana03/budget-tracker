import { useSearchParams } from 'react-router'

import { useAddSheet } from '@/app/add-sheet'
import { Screen } from '@/app/Screen'
import {
  BarChart,
  ButtonLink,
  Card,
  CategoryTile,
  ChartLegend,
  EmptyState,
  GlassButton,
  HighlightCard,
  HorizontalBar,
  Icon,
  InlineError,
  List,
  Row,
  SectionHeader,
  Segmented,
  SkeletonBlock,
  SkeletonRows,
  useToast,
} from '@/components/ui'
import { useHousehold } from '@/lib/api/queries'
import { formatMoney, formatPercent, localToday, useRegion } from '@/lib/format'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'

import {
  biggestDayBody,
  biggestDayTitle,
  changeBody,
  changeTitle,
  chartBars,
  chartDescription,
  headlineSentence,
  isEmptyInsights,
  isInsightsPeriod,
  PERIOD_OPTIONS,
  shareText,
  subscriptionsBody,
  subscriptionsTitle,
  supportingLine,
  type Insights,
  type InsightsPeriod,
} from './insights-text'
import { useInsights } from './useInsights'

/**
 * Insights — "What changed?" (design § 7). Period segmented (default 6 Months,
 * in the toolbar on desktop), the chart card with a takeaway headline, By Category
 * and Highlights. Copy states facts, never judgment.
 */
export function InsightsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('period')
  const period: InsightsPeriod = isInsightsPeriod(raw) ? raw : 'six_months'
  const setPeriod = (p: InsightsPeriod) =>
    setParams(
      (cur) => {
        const next = new URLSearchParams(cur)
        if (p === 'six_months') next.delete('period')
        else next.set('period', p)
        return next
      },
      { replace: true },
    )

  const regular = useIsRegular()
  const region = useRegion()
  const toast = useToast()
  const addSheet = useAddSheet()
  const household = useHousehold()
  const insights = useInsights(period)
  const data = insights.data
  const today = household.data?.today ?? localToday()

  const share = async () => {
    if (!data) return
    const text = shareText(data, today, { region })
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Insights', text })
        return
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ title: 'Copied' })
    } catch {
      toast.show({ title: 'Couldn’t copy. Try again.' })
    }
  }

  const empty = data ? isEmptyInsights(data) : false

  return (
    <Screen
      title="Insights"
      topBarActions={<GlassButton icon="export" label="Share Insights" onClick={share} disabled={!data || empty} />}
      toolbarControls={
        <Segmented variant="toolbar" aria-label="Period" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      }
    >
      <div className="flex flex-col gap-4 pb-6 lg:gap-5">
        <Segmented
          aria-label="Period"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
          className="lg:hidden"
        />
        {insights.isError && !data ? (
          <InlineError what="your insights" onRetry={() => insights.refetch()} />
        ) : !data ? (
          <InsightsSkeleton />
        ) : empty ? (
          <Card>
            <EmptyState
              icon="chart-bar"
              title="No Spending Yet"
              message="Insights appear here once you add a few expenses."
              action={{ label: 'Add Expense', onClick: () => addSheet.open(), icon: 'plus' }}
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-7 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5">
            <ChartCard data={data} today={today} compact={!regular} />
            <ByCategory data={data} />
            <Highlights data={data} today={today} />
          </div>
        )}
      </div>
    </Screen>
  )
}

function ChartCard({ data, today, compact }: { data: Insights; today: string; compact: boolean }) {
  const region = useRegion()
  const daily = data.period === 'week' || data.period === 'month'
  const hasProjection = data.bars.some((b) => b.isCurrent && b.projectedMinor != null)
  return (
    <section aria-label="Spending over time" className="lg:col-span-8 lg:row-start-1">
      <Card className="px-4 pt-[18px] pb-3 lg:px-[22px] lg:pt-[22px] lg:pb-4">
        <h2 className="m-0 mx-1 text-title-3 font-semibold lg:mx-0 lg:text-title-2 lg:font-bold">
          {headlineSentence(data.period, data.headline, data.homeCurrency, { region })}
        </h2>
        <p className="m-0 mx-1 mt-1 text-subhead text-label-2 lg:mx-0 lg:text-body">
          {supportingLine(data, today, { region })}
        </p>
        <BarChart
          className="mt-3.5"
          bars={chartBars(data.period, data.bars, { compact })}
          currency={data.homeCurrency}
          averageMinor={data.averageMinor}
          description={chartDescription(data.period, data.bars)}
        />
        <ChartLegend
          items={[
            'spent',
            ...(hasProjection ? (['projected'] as const) : []),
            'past',
            ...(data.averageMinor != null ? (['average'] as const) : []),
          ]}
          pastLabel={daily ? 'Past days' : 'Past months'}
          className="px-1 lg:px-0"
        />
      </Card>
    </section>
  )
}

function ByCategory({ data }: { data: Insights }) {
  const region = useRegion()
  const max = Math.max(...data.byCategory.map((c) => c.spentMinor), 1)
  if (data.byCategory.length === 0) return null
  return (
    <section aria-labelledby="h-by-category" className="lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
      <SectionHeader title="By Category" id="h-by-category" />
      <List>
        {data.byCategory.map((c) => {
          const amount = formatMoney(c.spentMinor, data.homeCurrency, { region })
          return (
            <Row
              key={c.category.id}
              leading={<CategoryTile color={c.category.color} icon={c.category.icon} />}
              className="items-start"
              size="single"
              to={`/budgets/${c.category.id}`}
              aria-label={`${c.category.name}: ${amount}, ${formatPercent(c.share)} of spending`}
              title={
                <span className="flex items-baseline justify-between gap-2.5">
                  <span className="truncate">{c.category.name}</span>
                  <strong className="text-subhead font-semibold text-label tabular-nums">{amount}</strong>
                </span>
              }
              subtitle={
                <span className="block w-full">
                  <HorizontalBar ratio={c.spentMinor / max} color={c.category.color} />
                  <span className="mt-1.5 block text-footnote">{formatPercent(c.share)} of spending</span>
                </span>
              }
            />
          )
        })}
      </List>
    </section>
  )
}

function Highlights({ data, today }: { data: Insights; today: string }) {
  const region = useRegion()
  const cur = data.homeCurrency
  const { biggestChange: change, biggestDay: day, subscriptions: subs } = data
  const daily = data.period === 'week' || data.period === 'month'
  // Sparks stop at the current bar: days after today are empty, not zero spending.
  const currentIndex = data.bars.findIndex((b) => b.isCurrent)
  const upTo = currentIndex >= 0 ? currentIndex + 1 : data.bars.length
  const changeSpark = change ? change.spark.slice(0, Math.min(upTo, change.spark.length)) : []
  const dayIndex = day && daily ? data.bars.findIndex((b) => b.startsOn === day.date) : -1
  const showSubs = subs.activeCount > 0 || subs.perMonthMinor > 0

  return (
    <section aria-labelledby="h-highlights" className="lg:col-span-8 lg:row-start-2">
      {(change || day || showSubs) && (
        <>
          <SectionHeader title="Highlights" id="h-highlights" />
          <div className="grid gap-3 lg:grid-cols-3 lg:gap-5 [&>*]:h-full">
            {change && (
              <HighlightCard
                kicker={{ icon: change.category.icon, label: change.category.name, color: change.category.color }}
                title={changeTitle(data.period, change)}
                body={changeBody(data.period, change, cur, { region })}
                spark={
                  changeSpark.length > 1
                    ? { values: changeSpark, highlight: changeSpark.length - 1, color: change.category.color }
                    : undefined
                }
              />
            )}
            {day && (
              <HighlightCard
                kicker={{ icon: 'calendar-blank', label: 'Biggest Day' }}
                title={biggestDayTitle(day, today)}
                body={biggestDayBody(day, cur, { region })}
                spark={
                  dayIndex >= 0 && dayIndex < upTo
                    ? { values: data.bars.slice(0, upTo).map((b) => b.spentMinor), highlight: dayIndex }
                    : undefined
                }
              />
            )}
            {showSubs && (
              <HighlightCard
                kicker={{ icon: 'arrows-clockwise', label: 'Subscriptions' }}
                title={subscriptionsTitle(subs, cur, { region })}
                body={subscriptionsBody(subs, today)}
              >
                <ButtonLink
                  to="/subscriptions"
                  variant="plain"
                  className="mt-1.5 h-9 px-0 font-semibold lg:h-9 lg:px-0"
                >
                  View Subscriptions <Icon name="caret-right" />
                </ButtonLink>
              </HighlightCard>
            )}
          </div>
        </>
      )}
      {/* Compact: Subscriptions is pushed from here, so it always has a row (design § 5.2). */}
      <List className="mt-4 lg:hidden">
        <Row
          leading={<CategoryTile color="gray" icon="arrows-clockwise" />}
          title="View Subscriptions"
          accessory="disclosure"
          to="/subscriptions"
        />
      </List>
    </section>
  )
}

function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-7 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5" aria-busy>
      <Card padded className="lg:col-span-8" aria-hidden>
        <SkeletonBlock className="h-6 w-4/5" />
        <SkeletonBlock className="mt-2 h-4 w-3/5" />
        <SkeletonBlock className="mt-5 h-44 w-full" />
      </Card>
      <SkeletonRows count={5} variant="budget" label="Loading insights" className="lg:col-span-4" />
    </div>
  )
}
