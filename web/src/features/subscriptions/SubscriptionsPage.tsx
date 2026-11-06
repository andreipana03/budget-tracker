import { useState } from 'react'

import { Screen, ToolbarButton, ToolbarGroup } from '@/app/Screen'
import {
  Card,
  CategoryTile,
  EmptyState,
  GlassButton,
  HeroAmount,
  Icon,
  InlineError,
  List,
  Row,
  Section,
  SectionFooter,
  SkeletonBlock,
  SkeletonRows,
  rowClasses,
} from '@/components/ui'
import { useHousehold, useSubscriptions, type Subscription, type SubscriptionList } from '@/lib/api/queries'
import { dueParts, formatMediumDate, formatMoney, formatShortDate, localToday, useRegion } from '@/lib/format'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { useBudgetMonth } from '@/features/budgets/useBudgets'
import { useOpenSession } from '@/features/budgets/use-open-session'

import { dueSoonText, repeatText } from './subscription-text'
import { SubscriptionSheet } from './SubscriptionSheet'

type SheetTarget = { mode: 'new' } | { mode: 'edit'; sub: Subscription }

/**
 * Subscriptions — "What will be charged, and when?" (design § 7). Pushed from
 * Insights on compact (Back to Insights), a sidebar section on desktop. Summary,
 * Next 7 Days / Later / Paused, waiting charges, and add/edit in a sheet.
 */
export function SubscriptionsPage() {
  const regular = useIsRegular()
  const subs = useSubscriptions()
  const household = useHousehold()
  const today = household.data?.today ?? localToday()
  const data = subs.data
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const session = useOpenSession(sheet != null)

  const openNew = () => setSheet({ mode: 'new' })
  const openEdit = (sub: Subscription) => setSheet({ mode: 'edit', sub })
  const total = data ? data.nextSevenDays.length + data.later.length + data.paused.length : 0

  return (
    <Screen
      title="Subscriptions"
      back={regular ? undefined : { to: '/insights', label: 'Back to Insights' }}
      topBarActions={<GlassButton icon="plus" label="New Subscription" onClick={openNew} />}
      toolbarControls={
        <ToolbarGroup>
          <ToolbarButton icon="plus" onClick={openNew}>
            New Subscription
          </ToolbarButton>
        </ToolbarGroup>
      }
    >
      <div className="flex flex-col gap-7 pb-6 lg:gap-5">
        {subs.isError && !data ? (
          <InlineError what="your subscriptions" onRetry={() => subs.refetch()} />
        ) : !data ? (
          <SubscriptionsSkeleton />
        ) : total === 0 && data.pendingCount === 0 ? (
          <Card>
            <EmptyState
              icon="arrows-clockwise"
              title="No Subscriptions Yet"
              message="Add payments that repeat, like a phone plan or streaming, to see what’s coming and when."
              action={{ label: 'New Subscription', onClick: openNew, icon: 'plus' }}
            />
          </Card>
        ) : (
          <>
            <Summary data={data} today={today} regular={regular} />
            {data.pendingCount > 0 && <PendingRow count={data.pendingCount} />}
            {regular ? (
              <SubscriptionTable data={data} today={today} onOpen={openEdit} />
            ) : (
              <CompactLists data={data} today={today} onOpen={openEdit} />
            )}
          </>
        )}
      </div>
      {sheet && (
        <SubscriptionSheet
          key={session}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          subscription={sheet.mode === 'edit' ? sheet.sub : undefined}
          today={today}
        />
      )}
    </Screen>
  )
}

/* ---------------------------------------------------------------- summary */

function Summary({ data, today, regular }: { data: SubscriptionList; today: string; regular: boolean }) {
  const region = useRegion()
  const cur = data.homeCurrency
  const perYear = formatMoney(data.perYearMinor, cur, { region, whole: true })
  const perMonth = (
    <SummaryCard label="Per month">
      <HeroAmount
        minor={data.perMonthMinor}
        currency={cur}
        size="large-title"
        approx={data.isApproximate}
        className="mt-0.5"
      />
      <p className="m-0 mt-1 text-subhead text-label-2 lg:text-callout">
        {perYear} a year · {data.activeCount} active
      </p>
    </SummaryCard>
  )
  if (!regular) return perMonth
  const expensesSoon = data.nextSevenDays.filter((s) => s.kind === 'expense')
  return (
    <div className="grid grid-cols-3 gap-5">
      {perMonth}
      <SummaryCard label="Next 7 days">
        <HeroAmount
          minor={data.nextSevenDaysHomeMinor}
          currency={cur}
          size="large-title"
          approx={expensesSoon.some((s) => s.currency !== cur)}
          className="mt-0.5"
        />
        <p className="m-0 mt-1 truncate text-callout text-label-2">{dueSoonText(expensesSoon, today)}</p>
      </SummaryCard>
      <BudgetShare data={data} />
    </div>
  )
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card padded role="group" aria-label={label}>
      <p className="m-0 text-subhead font-semibold text-label-2 lg:text-callout">{label}</p>
      {children}
    </Card>
  )
}

function BudgetShare({ data }: { data: SubscriptionList }) {
  const region = useRegion()
  const budgets = useBudgetMonth(undefined)
  const budget = budgets.data?.hasBudget ? budgets.data.totals.budgetMinor : null
  return (
    <SummaryCard label="Share of your budget">
      {data.shareOfBudget == null ? (
        <>
          <p className="m-0 mt-0.5 font-rounded text-large-title font-bold text-label-2">—</p>
          <p className="m-0 mt-1 text-callout text-label-2">Set a monthly budget to compare.</p>
        </>
      ) : (
        <>
          <p className="m-0 mt-0.5 font-rounded text-large-title font-bold tabular-nums">
            {Math.round(data.shareOfBudget * 100)}
            <span className="ml-[0.15em] text-[0.45em] font-semibold text-label-2">%</span>
          </p>
          <p className="m-0 mt-1 text-callout text-label-2">
            {budget != null
              ? `Of the ${formatMoney(budget, data.homeCurrency, { region, whole: true })} you budget each month`
              : 'Of what you budget each month'}
          </p>
        </>
      )}
    </SummaryCard>
  )
}

function PendingRow({ count }: { count: number }) {
  return (
    <List>
      <Row
        leading={
          <span
            aria-hidden
            className="grid size-[30px] place-items-center rounded-tile bg-tint-soft text-[18px] text-tint-text lg:size-7"
          >
            <Icon name="clock" />
          </span>
        }
        title={`${count} waiting for confirmation`}
        trailing="Review"
        accessory="disclosure"
        to="/activity?status=pending"
      />
    </List>
  )
}

/* ---------------------------------------------------------------- compact */

function convertedFooter(data: SubscriptionList, region: string | null | undefined) {
  const foreign = new Set(
    [...data.nextSevenDays, ...data.later, ...data.paused]
      .map((s) => s.currency)
      .filter((c) => c !== data.homeCurrency),
  )
  if (foreign.size === 0) return undefined
  const home = formatMoney(0, data.homeCurrency, { region }).replace(/[\d.,\s]/g, '') || data.homeCurrency
  const what = foreign.size === 1 && foreign.has('EUR') ? 'euros' : 'other currencies'
  return `Amounts in ${what} are converted to ${home} at today’s rate.`
}

function CompactLists({
  data,
  today,
  onOpen,
}: {
  data: SubscriptionList
  today: string
  onOpen: (s: Subscription) => void
}) {
  const region = useRegion()
  const note = convertedFooter(data, region)
  const groups = [
    { title: 'Next 7 Days', items: data.nextSevenDays },
    { title: 'Later', items: data.later },
    { title: 'Paused', items: data.paused },
  ].filter((g) => g.items.length > 0)
  return (
    <>
      {groups.map((g, i) => (
        <Section key={g.title} title={g.title} footer={i === groups.length - 1 ? note : undefined}>
          <List>
            {g.items.map((s) => (
              <SubscriptionRow key={s.id} s={s} today={today} home={data.homeCurrency} onOpen={onOpen} />
            ))}
          </List>
        </Section>
      ))}
    </>
  )
}

/** "In 3 days · Sat 21 Nov" with the relative part emphasized; later ones show the date. */
function DueText({ s, today, medium }: { s: Subscription; today: string; medium?: boolean }) {
  if (!s.isActive) return <span>Paused</span>
  const { relative, date } = dueParts(s.nextDueOn, today)
  const soon = s.daysUntilDue <= 7
  const dateText = medium ? formatMediumDate(s.nextDueOn) : date
  return (
    <span className="truncate">
      {soon && relative && (
        <>
          <strong className="font-semibold text-label">{relative}</strong> ·{' '}
        </>
      )}
      {dateText}
    </span>
  )
}

function SubscriptionRow({
  s,
  today,
  home,
  onOpen,
}: {
  s: Subscription
  today: string
  home: string
  onOpen: (s: Subscription) => void
}) {
  const region = useRegion()
  const amount = formatMoney(s.amountMinor, s.currency, { region, kind: s.kind })
  const converted = s.currency !== home && s.amountHomeMinor != null
  return (
    <Row
      leading={<CategoryTile color={s.category.color} monogram={s.title} size={40} />}
      title={s.title}
      subtitle={<DueText s={s} today={today} />}
      trailing={<span className={s.kind === 'income' ? 'text-positive' : undefined}>{amount}</span>}
      trailingSub={
        converted
          ? formatMoney(s.amountHomeMinor!, home, { region, approx: true, kind: s.kind })
          : repeatText(s.frequency, s.intervalCount)
      }
      onClick={() => onOpen(s)}
      aria-label={`${s.title}, ${amount}, ${repeatText(s.frequency, s.intervalCount)}, ${
        s.isActive ? `next ${formatShortDate(s.nextDueOn, today)}` : 'paused'
      }`}
    />
  )
}

/* ---------------------------------------------------------------- desktop table */

const COLS =
  'grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_120px] items-center gap-3.5'

function SubscriptionTable({
  data,
  today,
  onOpen,
}: {
  data: SubscriptionList
  today: string
  onOpen: (s: Subscription) => void
}) {
  const region = useRegion()
  const note = convertedFooter(data, region)
  const groups = [
    { title: 'Next 7 Days', items: data.nextSevenDays },
    { title: 'Later', items: data.later },
    { title: 'Paused', items: data.paused },
  ].filter((g) => g.items.length > 0)
  return (
    <section aria-label="All subscriptions">
      <List>
        <div
          aria-hidden
          className={cn(COLS, 'border-b-[0.5px] border-separator px-3.5 py-2 text-footnote font-semibold text-label-2')}
        >
          <span>Name</span>
          <span>Category</span>
          <span>Repeats</span>
          <span>Next Payment</span>
          <span>Account</span>
          <span className="text-right">Amount</span>
        </div>
        {groups.map((g, i) => (
          <div key={g.title}>
            <h3
              className={cn(
                'm-0 border-b-[0.5px] border-separator px-3.5 pt-3.5 pb-1.5 text-headline',
                i > 0 && 'border-t-[0.5px]',
              )}
            >
              {g.title}
            </h3>
            {g.items.map((s) => (
              <TableRow key={s.id} s={s} today={today} home={data.homeCurrency} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </List>
      {note && <SectionFooter>{note}</SectionFooter>}
    </section>
  )
}

function TableRow({
  s,
  today,
  home,
  onOpen,
}: {
  s: Subscription
  today: string
  home: string
  onOpen: (s: Subscription) => void
}) {
  const region = useRegion()
  const amount = formatMoney(s.amountMinor, s.currency, { region, kind: s.kind })
  const converted = s.currency !== home && s.amountHomeMinor != null
  return (
    <button
      type="button"
      onClick={() => onOpen(s)}
      className={cn(
        rowClasses({ hasLeading: false, interactive: true }),
        COLS,
        'min-h-[52px] py-2.5 text-body lg:py-2.5',
      )}
      aria-label={`${s.title}, ${s.category.name}, ${repeatText(s.frequency, s.intervalCount)}, ${
        s.isActive ? `next ${formatMediumDate(s.nextDueOn)}` : 'paused'
      }, ${s.account.name}, ${amount}`}
    >
      <span className="flex min-w-0 items-center gap-3 font-semibold">
        <CategoryTile color={s.category.color} monogram={s.title} size={40} />
        <span className="truncate">{s.title}</span>
      </span>
      <span className="truncate">{s.category.name}</span>
      <span className="truncate text-label-2">{repeatText(s.frequency, s.intervalCount)}</span>
      <span className="flex min-w-0 text-label-2">
        <DueText s={s} today={today} medium />
      </span>
      <span className="truncate text-label-2">{s.account.name}</span>
      <span className="flex flex-col items-end text-right tabular-nums">
        <span className={cn('whitespace-nowrap', s.kind === 'income' && 'text-positive')}>{amount}</span>
        {converted && (
          <span className="text-callout whitespace-nowrap text-label-2">
            {formatMoney(s.amountHomeMinor!, home, { region, approx: true, kind: s.kind })}
          </span>
        )}
      </span>
    </button>
  )
}

function SubscriptionsSkeleton() {
  return (
    <>
      <Card padded aria-hidden>
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="mt-2 h-9 w-40" />
        <SkeletonBlock className="mt-2 h-4 w-48" />
      </Card>
      <SkeletonRows count={4} variant="double" label="Loading subscriptions" />
    </>
  )
}
