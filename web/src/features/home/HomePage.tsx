import { useState } from 'react'

import { useAddSheet } from '@/app/add-sheet'
import { Screen } from '@/app/Screen'
import { BudgetRow } from '@/components/ui/BudgetRow'
import { ButtonLink } from '@/components/ui/Button'
import { GlassButton } from '@/components/ui/GlassButton'
import { Card, List } from '@/components/ui/List'
import { PaceAnimationScope } from '@/components/ui/PaceBar'
import { Section } from '@/components/ui/Section'
import { EmptyState, InlineError, SkeletonRows } from '@/components/ui/States'
import { TransactionRow } from '@/features/activity/TransactionRow'
import { MonthPicker } from '@/features/months/MonthPicker'
import { useMonthParam } from '@/features/months/useMonthParam'
import { useHousehold } from '@/lib/api/queries'
import { formatEyebrow, formatMonthName, localToday, monthOf } from '@/lib/format'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

import { HomeHero, HomeHeroSkeleton } from './HomeHero'
import { PendingRow, SubscriptionRow, WaitingHeader } from './UpcomingRows'
import { useHome, type Home } from './useHome'

const TWO_COLUMN_LIST =
  'lg:grid lg:grid-cols-2 lg:[&>*:nth-child(2)]:before:hidden lg:[&>*:nth-child(odd)]:border-r-[0.5px] lg:[&>*:nth-child(odd)]:border-separator'

/**
 * Home (design § 7): how much is left, and am I on pace?
 * Compact: eyebrow date + "November ⌄" (month picker) · hero · Budgets (4, ranked by
 * attention) · Upcoming (pending charges first, then what's due in 7 days) · Recent (4).
 * Desktop grid: hero 8 + Upcoming 4, all budgets in two columns 7 + Recent 5.
 */
export function HomePage() {
  const { month, setMonth } = useMonthParam()
  const home = useHome(month)
  const household = useHousehold()
  const isRegular = useIsRegular()
  const [pickerOpen, setPickerOpen] = useState(false)

  const today = home.data?.budget.period.today ?? household.data?.today ?? localToday()
  const currentMonth = household.data?.currentMonth ?? monthOf(today)
  const shownMonth = home.data?.budget.period.month ?? month ?? currentMonth
  const name = formatMonthName(shownMonth)

  return (
    <Screen
      title={name}
      eyebrow={formatEyebrow(today)}
      context={shownMonth.slice(0, 4)}
      titleAction={{ onClick: () => setPickerOpen(true), label: `${name} ${shownMonth.slice(0, 4)}, choose month` }}
      topBarActions={<GlassButton icon="user-circle" label="Profile and Settings" to="/settings" />}
    >
      <PaceAnimationScope id="home">
        {home.isError && !home.data ? (
          <InlineError what="this month" onRetry={() => void home.refetch()} />
        ) : (
          <HomeContent
            data={home.data}
            isRegular={isRegular}
            today={today}
            currentMonth={currentMonth}
            onGoToCurrent={() => setMonth(undefined)}
          />
        )}
      </PaceAnimationScope>
      <MonthPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={shownMonth}
        onSelect={(m) => setMonth(m === currentMonth ? undefined : m)}
      />
    </Screen>
  )
}

function HomeContent({
  data,
  isRegular,
  today,
  currentMonth,
  onGoToCurrent,
}: {
  data: Home | undefined
  isRegular: boolean
  today: string
  currentMonth: string
  onGoToCurrent: () => void
}) {
  const addSheet = useAddSheet()
  const budget = data?.budget
  const home = budget?.homeCurrency ?? 'RON'
  const elapsed = budget?.period.state === 'current' ? budget.period.elapsed : null

  // Budgets: compact shows the first 4 flexible ones by attention; desktop shows all.
  const attention = data ? (isRegular ? data.attention : data.attention.filter((l) => !l.category.isFixed).slice(0, 4)) : []
  // Upcoming: pending first, then what's due within 7 days (desktop fills up to 4 rows).
  const pending = data?.pending ?? []
  const dueSoon = data?.upcoming.filter((s) => s.daysUntilDue <= 7) ?? []
  const upcoming = data
    ? isRegular
      ? data.upcoming.slice(0, Math.max(dueSoon.length, 4 - pending.length))
      : dueSoon.length || pending.length
        ? dueSoon
        : data.upcoming.slice(0, 2)
    : []
  const recent = data?.recent.slice(0, isRegular ? 6 : 4) ?? []

  return (
    <div className="flex flex-col gap-7 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5">
      <section aria-label={budget ? `${formatMonthName(budget.period.month)} summary` : 'This month'} className="lg:col-span-8 lg:row-start-1 lg:self-stretch">
        {budget ? <HomeHero budget={budget} currentMonth={currentMonth} onGoToCurrent={onGoToCurrent} /> : <HomeHeroSkeleton />}
      </section>

      <Section
        title="Budgets"
        action={{ label: 'See All', to: '/budgets' }}
        className="lg:col-span-7 lg:row-start-2"
      >
        {!data ? (
          <SkeletonRows count={4} variant="budget" />
        ) : attention.length === 0 ? (
          <Card className="px-4 py-3.5 text-subhead text-label-2 lg:text-callout">
            No category has a budget this month.{' '}
            <ButtonLink to="/budgets?edit=1" variant="plain" size="small" className="-my-2 h-auto px-0 lg:h-auto lg:px-0">
              Set Budget
            </ButtonLink>
          </Card>
        ) : (
          <List className={cn(isRegular && TWO_COLUMN_LIST)}>
            {attention.map((l) => (
              <BudgetRow
                key={l.category.id}
                name={l.category.name}
                color={l.category.color}
                icon={l.category.icon}
                spentMinor={l.spentMinor}
                limitMinor={l.limitMinor}
                currency={home}
                status={l.status}
                elapsed={elapsed}
                fixed={l.category.isFixed}
                to={`/budgets/${l.category.id}`}
              />
            ))}
          </List>
        )}
      </Section>

      <Section
        title="Upcoming"
        action={{ label: 'See All', to: '/subscriptions' }}
        className="lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:flex lg:flex-col lg:self-stretch"
      >
        {!data ? (
          <SkeletonRows count={3} variant="double" className="lg:flex-1" />
        ) : pending.length + upcoming.length === 0 ? (
          <Card className="px-4 py-3.5 text-subhead text-label-2 lg:flex-1 lg:text-callout">Nothing due in the next 7 days.</Card>
        ) : (
          <List className="lg:flex-1">
            {pending.length > 0 && <WaitingHeader />}
            {pending.map((t) => (
              <PendingRow key={t.id} t={t} today={today} />
            ))}
            {upcoming.map((s) => (
              <SubscriptionRow key={s.id} s={s} today={today} homeCurrency={home} />
            ))}
          </List>
        )}
      </Section>

      <Section title="Recent" action={{ label: 'See All', to: '/activity' }} className="lg:col-span-5 lg:row-start-2">
        {!data ? (
          <SkeletonRows count={4} variant="double" />
        ) : recent.length === 0 ? (
          <Card>
            <EmptyState
              title="No Expenses Yet"
              message="Add your first expense with the + button."
              action={{ label: 'Add Expense', onClick: () => addSheet.open() }}
            />
          </Card>
        ) : (
          <List>
            {recent.map((t) => (
              <TransactionRow key={t.id} t={t} />
            ))}
          </List>
        )}
      </Section>
    </div>
  )
}
