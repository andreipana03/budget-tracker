import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Screen, ToolbarButton, ToolbarGroup } from '@/app/Screen'
import {
  BudgetRow,
  Button,
  Card,
  CategoryTile,
  EmptyState,
  GlassButton,
  Icon,
  InlineError,
  List,
  MiniPace,
  PaceBar,
  Pill,
  Section,
  SkeletonBlock,
  SkeletonRows,
  StatCards,
  rowClasses,
} from '@/components/ui'
import { useCategories } from '@/lib/api/queries'
import { formatMoney, formatMonthName, formatPercent, useRegion } from '@/lib/format'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { MonthPicker } from '@/features/months/MonthPicker'
import { useMonthParam } from '@/features/months/useMonthParam'

import type { BudgetLine, BudgetMonth } from './budget-edit'
import { categoryPath, monthLabel } from './budget-paths'
import { ChangeBudgetSheet } from './ChangeBudgetSheet'
import { EditBudgetsSheet } from './EditBudgetsSheet'
import { useBudgetMonth } from './useBudgets'
import { useOpenSession } from './use-open-session'

/**
 * Budgets — "Where am I against each limit?" (design § 7). Summary card (Budget /
 * Spent / Left + pace bar), Flexible and Fixed lists, Not Budgeted; one table on
 * desktop. `?edit=1` opens Edit Budgets. Every number comes from GET /budgets.
 */
export function BudgetsPage() {
  const { month, setMonth } = useMonthParam()
  const [params, setParams] = useSearchParams()
  const regular = useIsRegular()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [setBudgetFor, setSetBudgetFor] = useState<BudgetLine | null>(null)
  const budgets = useBudgetMonth(month)
  const categories = useCategories()
  const data = budgets.data

  const editOpen = params.get('edit') === '1'
  const setEditOpen = (open: boolean) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (open) next.set('edit', '1')
        else next.delete('edit')
        return next
      },
      { replace: !open },
    )
  const editSession = useOpenSession(editOpen)
  const changeSession = useOpenSession(setBudgetFor != null)

  const label = data ? monthLabel(data.period.month, data.period.today) : month ? formatMonthName(month) : ''

  return (
    <Screen
      title="Budgets"
      eyebrow={label}
      context={label}
      titleAction={{
        onClick: () => setPickerOpen(true),
        label: label ? `Budgets for ${label}, choose month` : 'Choose month',
      }}
      topBarActions={<GlassButton text="Edit" onClick={() => setEditOpen(true)} disabled={!data} />}
      toolbarControls={
        <ToolbarGroup>
          <ToolbarButton icon="pencil-simple" onClick={() => setEditOpen(true)}>
            Edit Budgets
          </ToolbarButton>
        </ToolbarGroup>
      }
    >
      <div className="flex flex-col gap-7 pb-6 lg:gap-5">
        {budgets.isError && !data ? (
          <InlineError what="your budgets" onRetry={() => budgets.refetch()} />
        ) : !data ? (
          <BudgetsSkeleton />
        ) : (
          <>
            {data.period.state !== 'current' && <MonthStateNote data={data} onCurrent={() => setMonth(undefined)} />}
            {data.hasBudget ? (
              <>
                <SummaryCard data={data} />
                {regular ? (
                  <BudgetTable data={data} month={month} onSetBudget={setSetBudgetFor} />
                ) : (
                  <CompactLists data={data} month={month} onSetBudget={setSetBudgetFor} />
                )}
              </>
            ) : (
              <>
                <Card>
                  <EmptyState
                    icon="chart-donut"
                    title="No Budgets Yet"
                    message={`Set a monthly limit for each category to see what’s left in ${label}.`}
                    action={{ label: 'Set Budgets', onClick: () => setEditOpen(true) }}
                  />
                </Card>
                {data.unbudgeted.some((l) => l.spentMinor > 0) && (
                  <NotBudgeted lines={data.unbudgeted} data={data} month={month} onSetBudget={setSetBudgetFor} />
                )}
              </>
            )}
          </>
        )}
      </div>

      {data && categories.data && (
        <EditBudgetsSheet
          key={editSession}
          open={editOpen}
          onOpenChange={setEditOpen}
          data={data}
          categories={categories.data}
        />
      )}
      {data && setBudgetFor && (
        <ChangeBudgetSheet
          key={`change-${changeSession}`}
          open
          onOpenChange={(o) => !o && setSetBudgetFor(null)}
          line={setBudgetFor}
          month={data.period.month}
          currency={data.homeCurrency}
        />
      )}
      <MonthPicker open={pickerOpen} onOpenChange={setPickerOpen} selected={month} onSelect={(m) => setMonth(m)} />
    </Screen>
  )
}

/** Past or future month: say so, and offer the way back. Facts only. */
function MonthStateNote({ data, onCurrent }: { data: BudgetMonth; onCurrent: () => void }) {
  const name = monthLabel(data.period.month, data.period.today)
  const current = formatMonthName(data.period.today)
  return (
    <div className="-mb-3 flex flex-wrap items-center gap-x-2 px-1 text-subhead text-label-2 lg:mb-0 lg:text-callout">
      <Icon name={data.period.state === 'past' ? 'check-circle' : 'calendar-blank'} className="text-[15px]" />
      <span>
        {data.period.state === 'past' ? `${name} is over. These are its final numbers.` : `${name} hasn’t started yet.`}
      </span>
      <button type="button" onClick={onCurrent} className="-my-2 py-2 text-tint-text">
        Go to {current}
      </button>
    </div>
  )
}

function SummaryCard({ data }: { data: BudgetMonth }) {
  const t = data.totals
  const cur = data.homeCurrency
  const over = t.leftMinor < 0
  return (
    <Card padded aria-label="Summary" role="region">
      <div className="lg:grid lg:grid-cols-[1.4fr_2fr] lg:items-center lg:gap-8">
        <StatCards
          items={[
            { label: 'Budget', minor: t.budgetMinor, currency: cur },
            { label: 'Spent', minor: t.spentMinor, currency: cur },
            { label: over ? 'Over' : 'Left', minor: Math.abs(t.leftMinor), currency: cur },
          ]}
        />
        <PaceBar
          className="mt-4 lg:mt-0"
          segments={data.segments.map((s) => ({
            color: s.category.color,
            amountMinor: s.amountMinor,
            name: s.category.name,
          }))}
          spentMinor={t.spentMinor}
          budgetMinor={t.budgetMinor}
          currency={cur}
          marker={data.period.state === 'current' ? t.paceMarker : null}
        />
      </div>
    </Card>
  )
}

function elapsedFor(data: BudgetMonth) {
  return data.period.state === 'current' ? data.period.elapsed : null
}

function CompactLists({
  data,
  month,
  onSetBudget,
}: {
  data: BudgetMonth
  month: string | undefined
  onSetBudget: (line: BudgetLine) => void
}) {
  const row = (l: BudgetLine, fixed: boolean) => (
    <BudgetRow
      key={l.category.id}
      name={l.category.name}
      color={l.category.color}
      icon={l.category.icon}
      spentMinor={l.spentMinor}
      limitMinor={l.limitMinor}
      currency={data.homeCurrency}
      status={l.status}
      elapsed={fixed ? null : elapsedFor(data)}
      fixed={fixed}
      to={categoryPath(l.category.id, month)}
    />
  )
  return (
    <>
      {data.flexible.length > 0 && (
        <Section
          title="Flexible"
          footer={
            data.period.state === 'current'
              ? 'The tick on each bar marks where you’d be today if you spent evenly through the month.'
              : undefined
          }
        >
          <List>{data.flexible.map((l) => row(l, false))}</List>
        </Section>
      )}
      {data.fixed.length > 0 && (
        <Section
          title="Fixed"
          footer="Fixed costs like rent and phone are counted in full and don’t change your daily amount."
        >
          <List>{data.fixed.map((l) => row(l, true))}</List>
        </Section>
      )}
      {data.unbudgeted.length > 0 && (
        <NotBudgeted lines={data.unbudgeted} data={data} month={month} onSetBudget={onSetBudget} />
      )}
    </>
  )
}

function NotBudgeted({
  lines,
  data,
  month,
  onSetBudget,
}: {
  lines: BudgetLine[]
  data: BudgetMonth
  month: string | undefined
  onSetBudget: (line: BudgetLine) => void
}) {
  const region = useRegion()
  return (
    <Section
      title="Not Budgeted"
      footer="Spending here still counts in Activity and Insights, but not against a limit."
    >
      <List>
        {lines.map((l) => (
          <div key={l.category.id} className={rowClasses({})}>
            <Link to={categoryPath(l.category.id, month)} className="flex min-w-0 flex-1 items-center gap-3">
              <CategoryTile color={l.category.color} icon={l.category.icon} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">{l.category.name}</span>
                <span className="block text-footnote text-label-2 tabular-nums">
                  {formatMoney(l.spentMinor, data.homeCurrency, { region })} spent
                </span>
              </span>
            </Link>
            <Button
              variant="plain"
              size="small"
              onClick={() => onSetBudget(l)}
              aria-label={`Set Budget for ${l.category.name}`}
            >
              Set Budget
            </Button>
          </div>
        ))}
      </List>
    </Section>
  )
}

/* ---------------------------------------------------------------- desktop table */

const COLS = 'grid grid-cols-[minmax(0,1.6fr)_minmax(0,2.6fr)_100px_100px_120px] items-center gap-4'

function BudgetTable({
  data,
  month,
  onSetBudget,
}: {
  data: BudgetMonth
  month: string | undefined
  onSetBudget: (line: BudgetLine) => void
}) {
  const current = data.period.state === 'current'
  return (
    <List aria-label="Budgets">
      <div
        aria-hidden
        className={cn(COLS, 'border-b-[0.5px] border-separator px-3.5 py-2 text-footnote font-semibold text-label-2')}
      >
        <span>Category</span>
        <span>Progress{current && <span className="font-normal"> · tick marks today’s even pace</span>}</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Budget</span>
        <span className="text-right">Left</span>
      </div>
      <div>
        {data.flexible.map((l) => (
          <TableRow key={l.category.id} line={l} data={data} month={month} />
        ))}
      </div>
      {data.fixed.length > 0 && (
        <div>
          <GroupHead title="Fixed" detail="Counted in full · not part of your daily amount" />
          {data.fixed.map((l) => (
            <TableRow key={l.category.id} line={l} data={data} month={month} fixed />
          ))}
        </div>
      )}
      {data.unbudgeted.length > 0 && (
        <div>
          <GroupHead title="Not Budgeted" detail="Spending without a monthly limit" />
          {data.unbudgeted.map((l) => (
            <TableRow key={l.category.id} line={l} data={data} month={month} onSetBudget={() => onSetBudget(l)} />
          ))}
        </div>
      )}
    </List>
  )
}

function GroupHead({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-y-[0.5px] border-separator px-3.5 pt-3.5 pb-1.5">
      <h3 className="m-0 text-headline">{title}</h3>
      <span className="text-subhead text-label-2">{detail}</span>
    </div>
  )
}

function TableRow({
  line: l,
  data,
  month,
  fixed,
  onSetBudget,
}: {
  line: BudgetLine
  data: BudgetMonth
  month: string | undefined
  fixed?: boolean
  onSetBudget?: () => void
}) {
  const region = useRegion()
  const cur = data.homeCurrency
  const hasLimit = l.limitMinor != null
  const over = hasLimit && l.status === 'over'
  const name = (
    <span className="flex min-w-0 items-center gap-3 text-body">
      <CategoryTile color={l.category.color} icon={l.category.icon} />
      <span className="truncate">{l.category.name}</span>
      {fixed && <Pill>Fixed</Pill>}
    </span>
  )
  const state = !hasLimit ? null : over ? (
    <span className="mt-1.5 flex items-center gap-1 text-footnote font-semibold text-negative">
      <Icon name="warning-circle" weight="fill" className="text-[14px]" />
      Over budget
    </span>
  ) : l.status === 'ahead' && !fixed ? (
    <span className="mt-1.5 flex items-center gap-1 text-footnote font-semibold text-label">
      <Icon name="trend-up" className="text-[14px]" />
      Ahead of pace
    </span>
  ) : (
    <span className="mt-1.5 block text-footnote text-label-2">{formatPercent(l.usedRatio ?? 0)} used</span>
  )
  const label = hasLimit
    ? `${l.category.name}: ${formatMoney(l.spentMinor, cur, { region })} spent of ${formatMoney(l.limitMinor!, cur, { region })}, ${
        over
          ? `${formatMoney(-l.leftMinor!, cur, { region })} over`
          : `${formatMoney(l.leftMinor!, cur, { region })} left`
      }`
    : `${l.category.name}: no budget, ${formatMoney(l.spentMinor, cur, { region })} spent`
  const rest = (
    <>
      <span className="min-w-0">
        {hasLimit ? (
          <>
            <MiniPace
              className="mt-0"
              spentMinor={l.spentMinor}
              limitMinor={l.limitMinor}
              elapsed={fixed ? null : elapsedFor(data)}
              fixed={fixed}
              color={l.category.color}
            />
            {state}
          </>
        ) : (
          onSetBudget && (
            <Button
              variant="plain"
              size="small"
              className="-ml-2"
              onClick={onSetBudget}
              aria-label={`Set Budget for ${l.category.name}`}
            >
              Set Budget
            </Button>
          )
        )}
      </span>
      <span className="text-right text-body whitespace-nowrap tabular-nums">
        {formatMoney(l.spentMinor, cur, { region })}
      </span>
      <span className="text-right text-body whitespace-nowrap text-label-2 tabular-nums">
        {hasLimit ? formatMoney(l.limitMinor!, cur, { region, whole: true }) : '—'}
      </span>
      {/* A negative left reads "−27,50 lei" (U+2212) in red. */}
      <span
        className={cn('text-right text-body whitespace-nowrap tabular-nums', over && 'font-semibold text-negative')}
      >
        {hasLimit ? formatMoney(l.leftMinor!, cur, { region }) : '—'}
      </span>
    </>
  )
  const classes = cn(rowClasses({ hasLeading: false, interactive: true }), COLS, 'min-h-12 py-3 lg:py-3')
  // Not Budgeted rows hold a button, so only the name is the link.
  if (onSetBudget)
    return (
      <div className={classes} role="group" aria-label={label}>
        <Link to={categoryPath(l.category.id, month)} className="min-w-0">
          {name}
        </Link>
        {rest}
      </div>
    )
  return (
    <Link to={categoryPath(l.category.id, month)} className={classes} aria-label={label}>
      {name}
      {rest}
    </Link>
  )
}

function BudgetsSkeleton() {
  return (
    <>
      <Card padded aria-hidden>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex flex-col gap-2">
              <SkeletonBlock className="h-3 w-12" />
              <SkeletonBlock className="h-6 w-20" />
            </span>
          ))}
        </div>
        <SkeletonBlock className="mt-6 h-3.5 w-full rounded-full" />
      </Card>
      <SkeletonRows count={5} variant="budget" label="Loading budgets" />
    </>
  )
}
