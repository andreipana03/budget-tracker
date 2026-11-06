import { useState } from 'react'
import { useParams } from 'react-router'

import { Screen, ToolbarButton, ToolbarGroup } from '@/app/Screen'
import {
  BarChart,
  Card,
  CategoryTile,
  EmptyState,
  GlassButton,
  Icon,
  InlineError,
  List,
  MiniPace,
  Pill,
  Row,
  Section,
  SkeletonBlock,
  SkeletonRows,
  StatCards,
} from '@/components/ui'
import { formatDay, formatMinorNumber, formatMoney, useRegion } from '@/lib/format'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'
import { useMonthParam } from '@/features/months/useMonthParam'
import { chartBars, chartDescription, headlineSentence } from '@/features/insights/insights-text'

import { allLines, type BudgetLine, type BudgetMonth } from './budget-edit'
import { monthLabel } from './budget-paths'
import { ChangeBudgetSheet } from './ChangeBudgetSheet'
import { useBudgetMonth, useCategoryHistory, useCategoryTransactions, type Transaction } from './useBudgets'
import { useOpenSession } from './use-open-session'

/**
 * Category detail (pushed from Budgets): Spent / Budget / Left with the mini pace
 * bar and its status note, the last six months, this month's transactions, and
 * "Change Budget" (amount + "Only {Month}").
 */
export function CategoryDetailPage() {
  const { categoryId } = useParams()
  const { month } = useMonthParam()
  const regular = useIsRegular()
  const budgets = useBudgetMonth(month)
  const data = budgets.data
  const line = data ? allLines(data).find((l) => l.category.id === categoryId) : undefined
  const [changeOpen, setChangeOpen] = useState(false)
  const session = useOpenSession(changeOpen)

  const back = { to: month ? `/budgets?month=${month}` : '/budgets', label: 'Back to Budgets' }
  const label = data ? monthLabel(data.period.month, data.period.today) : ''
  const changeLabel = line?.limitMinor == null ? 'Set Budget' : 'Change Budget'

  return (
    <Screen
      title={line?.category.name ?? (data ? 'Category' : '')}
      eyebrow={label}
      context={label}
      back={back}
      topBarActions={line && <GlassButton text="Edit" onClick={() => setChangeOpen(true)} />}
      toolbarControls={
        line && (
          <ToolbarGroup>
            <ToolbarButton icon="pencil-simple" onClick={() => setChangeOpen(true)}>
              {changeLabel}
            </ToolbarButton>
          </ToolbarGroup>
        )
      }
    >
      <div className="flex flex-col gap-7 pb-6 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5">
        {budgets.isError && !data ? (
          <InlineError what="this category" onRetry={() => budgets.refetch()} className="lg:col-span-12" />
        ) : !data ? (
          <Card padded className="lg:col-span-12" aria-hidden>
            <SkeletonBlock className="h-10 w-48" />
            <SkeletonBlock className="mt-5 h-6 w-full" />
          </Card>
        ) : !line ? (
          <Card className="lg:col-span-12">
            <EmptyState
              icon="chart-donut"
              title="Category Not Found"
              message="It may have been archived, or it isn’t an expense category."
            />
          </Card>
        ) : (
          <>
            <HeaderCard line={line} data={data} className="lg:col-span-12" />
            <History categoryId={line.category.id} currency={data.homeCurrency} compact={!regular} />
            <Transactions categoryId={line.category.id} month={month} data={data} />
          </>
        )}
      </div>
      {data && line && (
        <ChangeBudgetSheet
          key={session}
          open={changeOpen}
          onOpenChange={setChangeOpen}
          line={line}
          month={data.period.month}
          currency={data.homeCurrency}
        />
      )}
    </Screen>
  )
}

function HeaderCard({ line, data, className }: { line: BudgetLine; data: BudgetMonth; className?: string }) {
  const region = useRegion()
  const cur = data.homeCurrency
  const fixed = line.category.isFixed
  const hasLimit = line.limitMinor != null
  const over = hasLimit && line.status === 'over'
  const name = monthLabel(data.period.month, data.period.today)
  const ofText = hasLimit
    ? `${formatMinorNumber(line.spentMinor, cur, { region })} of ${formatMoney(line.limitMinor!, cur, { region, whole: true })}`
    : ''
  const scopeText = !hasLimit
    ? `No budget for ${name}`
    : line.scope === 'single_month'
      ? `Budget for ${name} only`
      : 'Monthly budget'

  return (
    <Card padded className={className}>
      <div className="flex items-center gap-3">
        <CategoryTile color={line.category.color} icon={line.category.icon} size={40} />
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-2 text-headline">
            <span className="truncate">{scopeText}</span>
            {fixed && <Pill>Fixed</Pill>}
          </p>
          <p className="m-0 truncate text-subhead text-label-2 lg:text-callout">
            {fixed ? 'Counted in full from the 1st' : 'Spent through the month'}
          </p>
        </div>
      </div>

      <div className="mt-5 lg:grid lg:grid-cols-[1.4fr_2fr] lg:items-center lg:gap-8">
        <StatCards
          items={
            hasLimit
              ? [
                  { label: 'Spent', minor: line.spentMinor, currency: cur },
                  { label: 'Budget', minor: line.limitMinor!, currency: cur },
                  { label: over ? 'Over' : 'Left', minor: Math.abs(line.leftMinor!), currency: cur },
                ]
              : [{ label: 'Spent', minor: line.spentMinor, currency: cur }]
          }
        />

        {hasLimit && (
          <div className="mt-4 lg:mt-0">
            <MiniPace
              spentMinor={line.spentMinor}
              limitMinor={line.limitMinor}
              elapsed={!fixed && data.period.state === 'current' ? data.period.elapsed : null}
              fixed={fixed}
              color={line.category.color}
            />
            {over ? (
              <p className="m-0 mt-2 flex items-center gap-1 text-footnote font-semibold text-negative">
                <Icon name="warning-circle" weight="fill" className="text-[14px]" />
                Over budget · {ofText}
              </p>
            ) : line.status === 'ahead' && !fixed ? (
              <p className="m-0 mt-2 flex items-center gap-1 text-footnote font-semibold text-label">
                <Icon name="trend-up" className="text-[14px]" />
                Ahead of pace ·<span className="font-normal text-label-2">{ofText}</span>
              </p>
            ) : (
              <p className="m-0 mt-2 text-footnote text-label-2 tabular-nums">{ofText}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function History({ categoryId, currency, compact }: { categoryId: string; currency: string; compact: boolean }) {
  const region = useRegion()
  const history = useCategoryHistory(categoryId)
  const d = history.data
  return (
    <Section title="Last 6 Months" className="lg:col-span-7">
      {history.isError && !d ? (
        <InlineError what="the last six months" onRetry={() => history.refetch()} />
      ) : !d ? (
        <Card padded aria-hidden>
          <SkeletonBlock className="h-5 w-3/4" />
          <SkeletonBlock className="mt-4 h-40 w-full" />
        </Card>
      ) : (
        <Card className="px-4 pt-4 pb-3 lg:px-[22px] lg:pt-5 lg:pb-4">
          <h3 className="m-0 mx-1 text-headline lg:mx-0">
            {headlineSentence(d.period, d.headline, d.homeCurrency, { region })}
          </h3>
          <BarChart
            className="mt-3"
            bars={chartBars(d.period, d.bars, { compact })}
            currency={currency}
            averageMinor={d.averageMinor}
            description={chartDescription(d.period, d.bars)}
          />
        </Card>
      )}
    </Section>
  )
}

function Transactions({
  categoryId,
  month,
  data,
}: {
  categoryId: string
  month: string | undefined
  data: BudgetMonth
}) {
  const tx = useCategoryTransactions(categoryId, month)
  const name = monthLabel(data.period.month, data.period.today)
  return (
    <Section title={`In ${name}`} className="lg:col-span-5">
      {tx.isError && !tx.data ? (
        <InlineError what="these transactions" onRetry={() => tx.refetch()} />
      ) : !tx.data ? (
        <SkeletonRows count={4} variant="double" label="Loading transactions" />
      ) : tx.data.items.length === 0 ? (
        <Card padded>
          <p className="m-0 text-center text-subhead text-label-2">No transactions in {name}.</p>
        </Card>
      ) : (
        <List>
          {tx.data.items.map((t) => (
            <TransactionRow key={t.id} t={t} today={data.period.today} />
          ))}
        </List>
      )}
    </Section>
  )
}

function TransactionRow({ t, today }: { t: Transaction; today: string }) {
  const region = useRegion()
  const converted = t.currency !== t.homeCurrency
  const amount = formatMoney(t.amountMinor, t.currency, { region, kind: t.kind })
  return (
    <Row
      leading={<CategoryTile color={t.category.color} monogram={t.title} size={40} />}
      title={t.title}
      subtitle={
        <>
          {t.status === 'pending' && <Pill tone="tint">Pending</Pill>}
          <span className="truncate">
            {formatDay(t.occurredOn, today)} · {t.account.name}
          </span>
        </>
      }
      trailing={<span className={t.kind === 'income' ? 'text-positive' : undefined}>{amount}</span>}
      trailingSub={converted ? formatMoney(t.homeAmountMinor, t.homeCurrency, { region }) : undefined}
      to={`/activity/${t.id}`}
      aria-label={`${t.title}, ${amount}, ${formatDay(t.occurredOn, today)}${t.status === 'pending' ? ', pending' : ''}`}
    />
  )
}
