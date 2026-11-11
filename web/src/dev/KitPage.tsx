/**
 * /dev/kit — every kit component in every variant, with the design's November
 * sample data (DesignAssets/mockups/app/app.js). Dev server only; not in the
 * production bundle. Use it for visual review against DesignAssets/screenshots.
 */
import { useRef, useState, type ReactNode } from 'react'

import { useAddSheet } from '@/app/add-sheet'
import { Screen, ToolbarButton, ToolbarGroup } from '@/app/Screen'
import {
  BarChart,
  BudgetRow,
  Button,
  Card,
  CategoryTile,
  ChartLegend,
  ConfirmDialog,
  DetailRow,
  EmptyState,
  GlassButton,
  HeroAmount,
  HighlightCard,
  HorizontalBar,
  Icon,
  InlineError,
  List,
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  Money,
  PaceBar,
  Pill,
  ResponsiveSheet,
  Row,
  SearchField,
  Section,
  Segmented,
  SelectRow,
  SkeletonRows,
  StatCards,
  SwitchRow,
  TextFieldRow,
  useToast,
  CATEGORY_ICON_CHOICES,
  type BudgetStatus,
  type IconName,
} from '@/components/ui'
import { CATEGORY_COLORS } from '@/lib/categories'
import { dueParts, formatEyebrow, formatMinorNumber, formatMoney, formatPercent, useRegion } from '@/lib/format'

const TODAY = '2026-11-18'
const ELAPSED = 18 / 30
const CUR = 'RON'

interface SampleCategory {
  key: string
  name: string
  color: string
  icon: string
  limit: number
  spent: number
  fixed?: boolean
}

const CATS: SampleCategory[] = [
  { key: 'groceries', name: 'Groceries', color: 'mint', icon: 'shopping-cart', limit: 60000, spent: 24640 },
  { key: 'eating', name: 'Eating Out', color: 'orange', icon: 'fork-knife', limit: 30000, spent: 32750 },
  { key: 'housing', name: 'Housing & Bills', color: 'indigo', icon: 'house-line', limit: 35000, spent: 29500, fixed: true },
  { key: 'transport', name: 'Transport', color: 'cyan', icon: 'bus', limit: 12000, spent: 5000 },
  { key: 'fun', name: 'Fun', color: 'purple', icon: 'ticket', limit: 20000, spent: 8499 },
  { key: 'shopping', name: 'Shopping', color: 'pink', icon: 'shopping-bag', limit: 25000, spent: 16990 },
  { key: 'education', name: 'Education', color: 'brown', icon: 'book-open', limit: 10000, spent: 4200 },
  { key: 'other', name: 'Other', color: 'gray', icon: 'dots-three', limit: 8000, spent: 1850 },
]
const cat = (k: string) => CATS.find((c) => c.key === k)!

function status(c: SampleCategory): BudgetStatus {
  const used = c.spent / c.limit
  if (used > 1) return 'over'
  if (!c.fixed && used > ELAPSED + 0.05) return 'ahead'
  return 'on_track'
}

const TOTAL_LIMIT = CATS.reduce((s, c) => s + c.limit, 0) // 200000
const TOTAL_SPENT = CATS.reduce((s, c) => s + c.spent, 0) // 123429
const FIXED_LIMIT = CATS.filter((c) => c.fixed).reduce((s, c) => s + c.limit, 0)
const FLEX_LIMIT = TOTAL_LIMIT - FIXED_LIMIT
const MARKER = (FIXED_LIMIT + FLEX_LIMIT * ELAPSED) / TOTAL_LIMIT
const SEGMENTS = [...CATS].sort((a, b) => Number(!!b.fixed) - Number(!!a.fixed)).map((c) => ({
  color: c.color,
  amountMinor: Math.min(c.spent, c.limit),
  name: c.name,
}))

const TX = [
  { id: 't1', title: 'Lidl', cat: 'groceries', account: 'ING Card', amount: 6430 },
  { id: 't2', title: 'Origo Coffee', cat: 'eating', account: 'Cash', amount: 1400 },
  { id: 't3', title: 'Copy Center', cat: 'education', account: 'Cash', amount: 600, note: 'Seminar handouts' },
  { id: 't5', title: 'Steam', cat: 'fun', account: 'Revolut', amount: 999, currency: 'EUR', home: 4975, note: 'Autumn sale' },
  { id: 't10', title: 'Spotify', cat: 'fun', account: 'ING Card', amount: 1299, repeat: true },
]

const SUBS = [
  { name: 'Netflix', color: 'purple', amount: 3999, next: '2026-11-21', cycle: 'Monthly' },
  { name: 'Digi Mobile', color: 'indigo', amount: 2500, next: '2026-11-25', cycle: 'Monthly' },
  { name: 'Metrorex Pass', color: 'cyan', amount: 5000, next: '2026-12-01', cycle: 'Monthly' },
  { name: 'Duolingo Super', color: 'brown', amount: 5999, currency: 'EUR', home: 29875, next: '2027-03-03', cycle: 'Yearly' },
]

const MONTHS = [
  { label: 'Jun', name: 'June', spentMinor: 181200 },
  { label: 'Jul', name: 'July', spentMinor: 214000 },
  { label: 'Aug', name: 'August', spentMinor: 165500 },
  { label: 'Sep', name: 'September', spentMinor: 238000 },
  { label: 'Oct', name: 'October', spentMinor: 194600 },
  { label: 'Nov', name: 'November', spentMinor: 123429, current: true, projectedMinor: 197000 },
]
const AVG = Math.round(MONTHS.filter((m) => !m.current).reduce((s, m) => s + m.spentMinor, 0) / 5)

const PERIODS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'six_months', label: '6 Months' },
  { value: 'year', label: 'Year' },
] as const

function KitSection({ title, span = 'lg:col-span-6', children }: { title: string; span?: string; children: ReactNode }) {
  return (
    <Section title={title} className={`min-w-0 ${span}`}>
      {children}
    </Section>
  )
}

export function KitPage() {
  const region = useRegion()
  const toast = useToast()
  const addSheet = useAddSheet()
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('six_months')
  const [kind, setKind] = useState<'all' | 'expense' | 'income'>('all')
  const [q, setQ] = useState('')
  const [note, setNote] = useState('Piața Obor')
  const [repeat, setRepeat] = useState<'never' | 'weekly' | 'monthly' | 'yearly'>('never')
  const [fixed, setFixed] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetAmount, setSheetAmount] = useState('24,50')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sort, setSort] = useState('date')
  const amountRef = useRef<HTMLInputElement>(null)
  const byCat = [...CATS].sort((a, b) => b.spent - a.spent)

  return (
    <Screen
      title="Component Kit"
      eyebrow={formatEyebrow(TODAY)}
      context="November 2026 sample data"
      topBarActions={<GlassButton icon="user-circle" label="Profile and Settings" to="/settings" />}
      toolbarControls={
        <ToolbarGroup>
          <ToolbarButton icon="pencil-simple">Edit Budgets</ToolbarButton>
        </ToolbarGroup>
      }
    >
      <div className="flex flex-col gap-7 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5">
        {/* Hero */}
        <section aria-label="This month" className="lg:col-span-8">
          <Card padded className="lg:px-[26px] lg:py-6">
            <div className="lg:flex lg:items-start lg:justify-between lg:gap-6">
              <div>
                <p className="m-0 text-subhead font-semibold text-label-2">Left to spend in November</p>
                <HeroAmount minor={TOTAL_LIMIT - TOTAL_SPENT} currency={CUR} className="mt-0.5" />
                <p className="m-0 mt-1 text-subhead text-label-2">
                  About {formatMoney(5450, CUR, { region, whole: true })} a day for the next 13 days
                </p>
              </div>
              <p className="m-0 mt-3.5 inline-flex items-center gap-1.5 text-subhead font-semibold lg:mt-1.5">
                <Icon name="check-circle" weight="fill" className="text-[18px] text-positive" />
                On track <span className="font-normal text-label-2">· {formatMoney(5100, CUR, { region, whole: true })} under pace</span>
              </p>
            </div>
            <PaceBar
              className="mt-3.5 lg:mt-[22px]"
              segments={SEGMENTS}
              spentMinor={TOTAL_SPENT}
              budgetMinor={TOTAL_LIMIT}
              currency={CUR}
              marker={MARKER}
              legend={CATS.map((c) => ({ name: c.name, color: c.color, spentMinor: c.spent }))}
            />
          </Card>
        </section>

        {/* Upcoming: subscription rows with monograms */}
        <KitSection title="Upcoming" span="lg:col-span-4">
          <List>
            {SUBS.map((s) => {
              const due = dueParts(s.next, TODAY)
              return (
                <Row
                  key={s.name}
                  leading={<CategoryTile color={s.color} monogram={s.name} size={40} />}
                  title={s.name}
                  subtitle={
                    due.relative && !due.relative.includes('ago') ? (
                      <>
                        <span className="font-semibold text-label">{due.relative}</span> · {due.date}
                      </>
                    ) : (
                      due.date
                    )
                  }
                  trailing={<Money minor={s.amount} currency={s.currency ?? CUR} />}
                  trailingSub={s.home ? <Money minor={s.home} currency={CUR} approx /> : s.cycle}
                  onClick={() => undefined}
                />
              )
            })}
          </List>
        </KitSection>

        {/* Budget rows */}
        <KitSection title="Budgets" span="lg:col-span-7">
          <List className="lg:grid lg:grid-cols-2 lg:[&>*:nth-child(2)]:before:hidden lg:[&>*:nth-child(odd)]:border-r-[0.5px] lg:[&>*:nth-child(odd)]:border-separator">
            {[...CATS]
              .sort((a, b) => b.spent / b.limit - a.spent / a.limit)
              .map((c) => (
                <BudgetRow
                  key={c.key}
                  name={c.name}
                  color={c.color}
                  icon={c.icon}
                  spentMinor={c.spent}
                  limitMinor={c.limit}
                  currency={CUR}
                  status={status(c)}
                  elapsed={ELAPSED}
                  fixed={c.fixed}
                  onClick={() => undefined}
                />
              ))}
            <BudgetRow
              name="Gifts"
              color="yellow"
              icon="gift"
              spentMinor={4200}
              limitMinor={null}
              currency={CUR}
              status="on_track"
              elapsed={ELAPSED}
            />
          </List>
        </KitSection>

        {/* Transactions */}
        <KitSection title="Recent" span="lg:col-span-5">
          <List>
            {TX.map((t) => {
              const c = cat(t.cat)
              return (
                <Row
                  key={t.id}
                  leading={<CategoryTile color={c.color} icon={c.icon} size={40} />}
                  title={t.title}
                  subtitle={
                    <>
                      {c.name} ·{t.repeat && <Icon name="arrows-clockwise" className="text-[13px]" />} {t.note ?? t.account}
                    </>
                  }
                  trailing={<Money minor={t.amount} currency={t.currency ?? CUR} />}
                  trailingSub={t.home ? <Money minor={t.home} currency={CUR} /> : undefined}
                  to={`/activity/${t.id}`}
                  selected={t.id === 't5'}
                />
              )
            })}
            <Row
              leading={<CategoryTile color="green" icon="graduation-cap" size={40} />}
              title="Scholarship"
              subtitle="Scholarship · Merit scholarship"
              trailing={<Money minor={85000} currency={CUR} kind="income" />}
              onClick={() => undefined}
            />
            <Row
              leading={<CategoryTile color="purple" monogram="N" size={40} />}
              title={
                <>
                  Netflix <Pill tone="tint">Pending</Pill>
                </>
              }
              subtitle="Fun · ING Card"
              trailing={<Money minor={3999} currency={CUR} />}
              onClick={() => undefined}
            />
          </List>
        </KitSection>

        {/* Budgets summary */}
        <KitSection title="Summary">
          <Card padded>
            <StatCards
              items={[
                { label: 'Budget', minor: TOTAL_LIMIT, currency: CUR },
                { label: 'Spent', minor: TOTAL_SPENT, currency: CUR },
                { label: 'Left', minor: TOTAL_LIMIT - TOTAL_SPENT, currency: CUR },
              ]}
            />
            <PaceBar className="mt-4" segments={SEGMENTS} spentMinor={TOTAL_SPENT} budgetMinor={TOTAL_LIMIT} currency={CUR} marker={MARKER} />
          </Card>
          <Card padded className="mt-3">
            <p className="m-0 text-subhead font-semibold text-label-2">Per month</p>
            <HeroAmount minor={16287} currency={CUR} size="large-title" approx />
            <p className="m-0 mt-1 text-subhead text-label-2">1.954 lei a year · 6 active</p>
          </Card>
        </KitSection>

        {/* Chart */}
        <section className="lg:col-span-8" aria-label="Chart">
          <Card className="px-4 pt-4 pb-3 lg:px-[22px] lg:pt-[22px] lg:pb-4">
            <h2 className="m-0 mx-1 text-title-3 lg:mx-0 lg:text-title-2">You’ve spent 8% less than at this point in October.</h2>
            <p className="m-0 mx-1 mt-1 text-subhead text-label-2 lg:mx-0 lg:text-body">
              On pace for about {formatMoney(197000, CUR, { region, whole: true })} · your average month is{' '}
              {formatMoney(AVG, CUR, { region, whole: true })}
            </p>
            <BarChart
              className="mt-3.5"
              bars={MONTHS}
              currency={CUR}
              averageMinor={AVG}
              description="Monthly spending, June to November 2026."
            />
            <ChartLegend />
          </Card>
        </section>

        {/* By category */}
        <KitSection title="By Category" span="lg:col-span-4">
          <List>
            {byCat.map((c) => (
              <Row
                key={c.key}
                leading={<CategoryTile color={c.color} icon={c.icon} />}
                className="items-start"
                title={
                  <span className="flex items-baseline justify-between gap-2.5">
                    <span className="truncate">{c.name}</span>
                    <strong className="text-subhead font-semibold tabular-nums">{formatMoney(c.spent, CUR, { region })}</strong>
                  </span>
                }
                subtitle={
                  <span className="block w-full">
                    <HorizontalBar ratio={c.spent / byCat[0].spent} color={c.color} />
                    <span className="mt-1.5 block text-footnote">{formatPercent(c.spent / TOTAL_SPENT)} of spending</span>
                  </span>
                }
                size="single"
                onClick={() => undefined}
              />
            ))}
          </List>
        </KitSection>

        {/* Highlights */}
        <section className="lg:col-span-12" aria-label="Highlights">
          <h2 className="m-0 px-1 pb-2 text-title-3 font-bold lg:px-0.5 lg:pb-2.5 lg:text-title-2">Highlights</h2>
          <div className="grid gap-3 lg:grid-cols-3 lg:gap-5">
            <HighlightCard
              kicker={{ icon: 'fork-knife', label: 'Eating Out', color: 'orange' }}
              title="Up 32% from October"
              body={`${formatMoney(32750, CUR, { region })} so far, against ${formatMoney(24800, CUR, { region, whole: true })} by this point last month.`}
              spark={{ values: [210, 260, 180, 240, 248, 327.5], highlight: 5, color: 'orange' }}
            />
            <HighlightCard
              kicker={{ icon: 'calendar-blank', label: 'Biggest Day' }}
              title="Friday, 13 November"
              body={`${formatMoney(21460, CUR, { region })}, mostly Shopping and Eating Out.`}
              spark={{ values: [40, 62, 18, 214.6, 35, 71, 28, 130, 22, 84], highlight: 3 }}
            />
            <HighlightCard
              kicker={{ icon: 'arrows-clockwise', label: 'Subscriptions' }}
              title={`${formatMoney(16287, CUR, { region, approx: true })} a month`}
              body="6 active · Netflix renews on Saturday."
            >
              <Button variant="plain" className="mt-1.5 h-9 px-0 font-semibold lg:h-9 lg:px-0">
                View Subscriptions <Icon name="caret-right" />
              </Button>
            </HighlightCard>
          </div>
        </section>

        {/* Controls */}
        <KitSection title="Controls">
          <Card padded className="flex flex-col gap-4">
            <Segmented
              aria-label="Show"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All' },
                { value: 'expense', label: 'Expenses' },
                { value: 'income', label: 'Income' },
              ]}
            />
            <Segmented aria-label="Period" value={period} onChange={setPeriod} options={PERIODS} />
            <SearchField label="Search transactions" value={q} onValueChange={setQ} data-search-field="kit" />
            <div className="flex flex-wrap items-center gap-2">
              <Pill>Fixed</Pill>
              <Pill tone="tint">Pending</Pill>
              <Money minor={2750} currency={CUR} over className="text-subhead" />
              <Money minor={85000} currency={CUR} kind="income" className="text-subhead" />
              <Money minor={388230} currency={CUR} approx className="text-subhead" />
              <Money minor={999} currency="EUR" className="text-subhead" />
              <Money minor={200000} currency={CUR} whole className="text-subhead" />
            </div>
          </Card>
        </KitSection>

        <KitSection title="Buttons">
          <Card padded className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="prominent" icon="plus" onClick={() => addSheet.open()}>
                Add Expense
              </Button>
              <Button variant="secondary">Cancel</Button>
              <Button variant="plain">See All</Button>
              <Button variant="destructive" icon="trash">
                Delete
              </Button>
              <Button variant="prominent" disabled>
                Save Changes
              </Button>
              <Button size="small" variant="secondary" icon="pencil-simple">
                Edit
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-fill-3 p-3">
              <GlassButton icon="caret-left" label="Back to Insights" />
              <GlassButton icon="user-circle" label="Profile and Settings" />
              <GlassButton icon="sliders-horizontal" label="Filter" />
              <GlassButton text="Edit" />
              <GlassButton icon="x" label="Cancel" />
              <GlassButton icon="check" label="Add Expense" prominent />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>
                Open Sheet
              </Button>
              <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
                Delete Category…
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  toast.show({ title: 'Transaction deleted', action: { label: 'Undo', onClick: () => toast.show({ title: 'Transaction restored' }) } })
                }
              >
                Show Toast
              </Button>
              <Menu.Root>
                <Menu.Trigger className="pressable inline-flex h-[50px] items-center gap-1.5 rounded-full bg-fill-2 px-5 text-body font-semibold lg:h-8 lg:rounded-sm lg:px-3.5">
                  Sort <Icon name="caret-up-down" className="text-[13px] text-label-2" />
                </Menu.Trigger>
                <MenuPopup>
                  <MenuRadioGroup value={sort} onValueChange={(v) => setSort(String(v))}>
                    <MenuRadioItem value="date">Date</MenuRadioItem>
                    <MenuRadioItem value="amount">Amount</MenuRadioItem>
                    <MenuRadioItem value="name">Name</MenuRadioItem>
                  </MenuRadioGroup>
                  <MenuSeparator />
                  <MenuItem icon="export">Export</MenuItem>
                  <MenuItem icon="trash" destructive>
                    Delete
                  </MenuItem>
                </MenuPopup>
              </Menu.Root>
            </div>
          </Card>
        </KitSection>

        {/* Form rows */}
        <KitSection title="Form Rows">
          <List>
            <TextFieldRow label="Note" placeholder="Merchant or note" value={note} onChange={(e) => setNote(e.target.value)} />
            <DetailRow label="Date" value="Today" onClick={() => undefined} />
            <DetailRow
              label="Category"
              value="Fun"
              valueLeading={<CategoryTile color="purple" icon="ticket" size={20} />}
              accessory="none"
            />
            <SelectRow
              label="Repeat"
              value={repeat}
              onValueChange={setRepeat}
              options={[
                { value: 'never', label: 'Never' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
            <SwitchRow label="Fixed" description="Counted in full from day 1" checked={fixed} onCheckedChange={setFixed} />
          </List>
        </KitSection>

        {/* States */}
        <KitSection title="Loading">
          <div className="flex flex-col gap-3">
            <SkeletonRows count={2} variant="double" />
            <SkeletonRows count={2} variant="budget" />
            <InlineError what="your budgets" onRetry={() => toast.show({ title: 'Trying again' })} />
          </div>
        </KitSection>

        <KitSection title="Empty">
          <Card>
            <EmptyState
              icon="receipt"
              title="No Expenses Yet"
              message="Add your first expense with the + button."
              action={{ label: 'Add Expense', onClick: () => addSheet.open() }}
            />
          </Card>
        </KitSection>

        {/* Tiles + icons */}
        <section className="lg:col-span-12" aria-label="Tiles and icons">
          <h2 className="m-0 px-1 pb-2 text-title-3 font-bold lg:text-title-2">Tiles</h2>
          <Card padded className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              {([20, 30, 40, 52] as const).map((s) => (
                <CategoryTile key={s} color="mint" icon="shopping-cart" size={s} />
              ))}
              {([20, 30, 40, 52] as const).map((s) => (
                <CategoryTile key={`m${s}`} color="purple" monogram="N" size={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {CATEGORY_COLORS.map((c) => (
                <span key={c} className="flex flex-col items-center gap-1 text-caption-1 text-label-2">
                  <CategoryTile color={c} icon="tag" size={40} />
                  {c}
                  <span className="h-1.5 w-10 rounded-full" style={{ background: `var(--hue-${c})` }} />
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2">
              {CATEGORY_ICON_CHOICES.map((n) => (
                <span key={n} title={n} className="grid place-items-center">
                  <CategoryTile color="gray" icon={n as IconName} size={30} />
                </span>
              ))}
            </div>
            <p className="m-0 text-footnote text-label-2">
              Over budget {formatMinorNumber(32750, CUR, { region })} of {formatMoney(30000, CUR, { region, whole: true })} ·
              ratio {formatPercent(32750 / 30000)}
            </p>
          </Card>
        </section>
      </div>

      <ResponsiveSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="New Expense"
        confirmLabel="Add Expense"
        confirmVerb="add"
        onConfirm={() => {
          setSheetOpen(false)
          toast.show({ title: 'Expense added' })
        }}
        confirmDisabled={!sheetAmount}
        isDirty={sheetAmount !== '24,50'}
        discardTitle="Discard this expense?"
        initialFocus={amountRef}
      >
        <Segmented
          aria-label="Type"
          value={'expense' as 'expense' | 'income'}
          onChange={() => undefined}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <div className="py-6 text-center">
          <label className="sr-only" htmlFor="kit-amount">
            Amount
          </label>
          <input
            id="kit-amount"
            ref={amountRef}
            inputMode="decimal"
            value={sheetAmount}
            onChange={(e) => setSheetAmount(e.target.value)}
            className="w-48 border-0 bg-transparent text-center font-rounded text-[3.53rem] leading-none font-bold tabular-nums outline-none lg:text-[3rem]"
          />
          <p className="m-0 mt-2.5 text-footnote text-label-2">329,10 lei left in Groceries after this</p>
        </div>
        <List>
          <TextFieldRow label="Note" placeholder="Merchant or note" value={note} onChange={(e) => setNote(e.target.value)} />
          <DetailRow label="Date" value="Today" onClick={() => undefined} />
          <SelectRow
            label="Repeat"
            value={repeat}
            onValueChange={setRepeat}
            options={[
              { value: 'never', label: 'Never' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
        </List>
      </ResponsiveSheet>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete “Groceries” and its 42 transactions?"
        message="This can’t be undone."
        confirmLabel="Delete Category"
        destructive
        onConfirm={() => setConfirmOpen(false)}
      />
    </Screen>
  )
}
