import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { useAddSheet } from '@/app/add-sheet'
import { Screen } from '@/app/Screen'
import { useTransferSheet } from '@/app/transfer-sheet'
import { Card, List } from '@/components/ui/List'
import { GlassButton } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem } from '@/components/ui/Menu'
import { SearchField } from '@/components/ui/SearchField'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState, InlineError, SkeletonBlock, SkeletonRows } from '@/components/ui/States'
import { TransferActions, TransferFacts, TransferHeader } from '@/features/transfers/TransferDetails'
import { TransferRow } from '@/features/transfers/TransferRow'
import { useTransferActions } from '@/features/transfers/useTransfers'
import { useAccounts, useCategories, useHousehold } from '@/lib/api/queries'
import { formatMonthName, localToday, monthOf } from '@/lib/format'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

import { ActivityTable, ActivityTableSkeleton } from './ActivityTable'
import { DayHeading } from './DayHeading'
import { FilterSheet } from './FilterSheet'
import { useDebouncedValue, useLoadMore } from './hooks'
import { addRecentSearch, clearRecentSearches, readRecentSearches } from './recent-searches'
import { SwipeRow } from './SwipeRow'
import { TransactionActions, TransactionFacts, TransactionHeader } from './TransactionDetails'
import { TransactionRow } from './TransactionRow'
import { flattenPages, groupByDay, type ActivityEntry, type EntryKind } from './transactions'
import { useTransactionActions } from './useTransactionActions'
import { useTransactions, type TransactionStatus } from './useTransactions'

type KindFilter = 'all' | EntryKind

const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: 'Waiting for Confirmation',
  posted: 'Confirmed',
  skipped: 'Skipped',
}

/** The facts list inside the inspector card: flush, with a hairline above. */
const INSPECTOR_LIST = 'rounded-none border-t-[0.5px] border-separator shadow-none lg:rounded-none lg:shadow-none'

const KIND_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
] as const

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || el.closest('input, textarea, select') != null
}

/**
 * Activity (design § 7): what did I spend on?
 * Compact: large title, search (recent searches when empty), All/Expenses/Income, day
 * groups of two-line rows with swipe actions, infinite scroll, Filter sheet.
 * Desktop: filters row (segmented + category/account pop-ups), the day-grouped table
 * with one selected row (↑↓, Return edits, ⌫ deletes with Undo) and the sticky inspector.
 * Transfers between accounts are listed with the transactions, in the same order (never
 * counted in the day totals); the Expenses/Income and category filters leave them out.
 * Filters live in the URL: ?q=&kind=&category=&account=&status= (status=pending is linked
 * from Subscriptions' "waiting for confirmation" row).
 */
export function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const kindParam = params.get('kind')
  const kind: EntryKind | undefined = kindParam === 'expense' || kindParam === 'income' ? kindParam : undefined
  const categoryId = params.get('category') ?? undefined
  const accountId = params.get('account') ?? undefined
  const statusParam = params.get('status')
  const status: TransactionStatus | undefined =
    statusParam === 'pending' || statusParam === 'posted' || statusParam === 'skipped' ? statusParam : undefined
  const debouncedQ = useDebouncedValue(q.trim(), 250)

  const isRegular = useIsRegular()
  const household = useHousehold()
  const categories = useCategories()
  const accounts = useAccounts()
  const addSheet = useAddSheet()
  const transferSheet = useTransferSheet()
  const actions = useTransactionActions()
  const transferActions = useTransferActions()
  const list = useTransactions({ kind, status, categoryId, accountId, q: debouncedQ, includeTransfers: true })

  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const today = household.data?.today ?? localToday()
  const monthName = formatMonthName(household.data?.currentMonth ?? monthOf(today))

  const { entries: items, dayTotals } = useMemo(() => flattenPages(list.data?.pages ?? []), [list.data])
  const groups = useMemo(() => groupByDay(items, dayTotals), [items, dayTotals])
  const selected = items.find((e) => e.id === selectedId) ?? items[0]
  const homeCurrency = list.data?.pages[0]?.homeCurrency ?? household.data?.homeCurrency

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [k, v] of Object.entries(changes)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const filterCategories = (categories.data ?? []).filter((c) => !kind || c.kind === kind)
  const accountItems = accounts.data?.items ?? []
  const activeFilters = Number(Boolean(categoryId)) + Number(Boolean(accountId))

  const loadMoreRef = useLoadMore(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
  }, Boolean(list.hasNextPage))

  const edit = useCallback(
    (e: ActivityEntry) =>
      e.type === 'transfer'
        ? transferSheet.open({ transferId: e.id })
        : addSheet.open({ transactionId: e.id, kind: e.transaction.kind }),
    [addSheet, transferSheet],
  )
  const remove = useCallback(
    (e: ActivityEntry) => {
      const i = items.findIndex((x) => x.id === e.id)
      const next = items[i + 1] ?? items[i - 1]
      if (e.id === selected?.id) setSelectedId(next?.id)
      if (e.type === 'transfer') void transferActions.remove(e.transfer)
      else void actions.remove(e.transaction)
    },
    [items, selected, actions, transferActions],
  )

  // Desktop keyboard: ↑↓ move the selection, Return edits, ⌫ deletes (with Undo).
  useEffect(() => {
    if (!isRegular) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTextField(e.target)) return
      // A modal sheet, alert or open menu owns the keyboard (toasts are non-modal dialogs: ignore them).
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"]')) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target && target.closest('button, a') && !target.closest('[role="listbox"]')) return
      if (!selected) return
      const i = items.findIndex((x) => x.id === selected.id)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = items[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)]
        if (next) setSelectedId(next.id)
        if (e.key === 'ArrowDown' && i >= items.length - 3 && list.hasNextPage) void list.fetchNextPage()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        edit(selected)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        remove(selected)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isRegular, items, selected, edit, remove, list])

  const filtering = Boolean(debouncedQ || kind || status || categoryId || accountId)
  const empty = !list.isPending && !list.isError && items.length === 0

  let content: ReactNode
  if (list.isPending) {
    content = isRegular ? <ActivityTableSkeleton /> : <CompactSkeleton />
  } else if (list.isError && items.length === 0) {
    content = <InlineError what="your transactions" onRetry={() => void list.refetch()} className="mt-5 lg:mt-0" />
  } else if (empty) {
    content = (
      <Card className="mt-5 lg:mt-0">
        {debouncedQ ? (
          <EmptyState
            icon="magnifying-glass"
            title={`No Results for “${debouncedQ}”`}
            message="Check the spelling or try a new search."
          />
        ) : filtering ? (
          <EmptyState
            icon="sliders-horizontal"
            title="No Transactions"
            message="Nothing matches these filters."
            action={{
              label: 'Clear Filters',
              onClick: () => update({ kind: undefined, status: undefined, category: undefined, account: undefined }),
            }}
          />
        ) : (
          <EmptyState
            title="No Expenses Yet"
            message="Add your first expense with the + button."
            action={{ label: 'Add Expense', onClick: () => addSheet.open() }}
          />
        )}
      </Card>
    )
  } else if (isRegular) {
    content = (
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-5">
        <div>
          <ActivityTable
            groups={groups}
            selectedId={selected?.id}
            onSelect={(e) => setSelectedId(e.id)}
            onOpen={edit}
            today={today}
            timezone={household.data?.timezone}
            kind={kind}
            currency={homeCurrency}
          />
          <div ref={loadMoreRef} aria-hidden className="h-px" />
          {list.isFetchingNextPage && <ActivityTableSkeleton rows={2} />}
        </div>
        {selected && (
          <aside className="sticky top-[84px]" aria-label={selected.type === 'transfer' ? 'Transfer details' : 'Transaction details'}>
            <Card className="overflow-hidden">
              {selected.type === 'transfer' ? (
                <>
                  <TransferHeader tr={selected.transfer} />
                  <TransferFacts tr={selected.transfer} className={INSPECTOR_LIST} />
                  <TransferActions tr={selected.transfer} className="border-t-[0.5px] border-separator p-3.5" />
                </>
              ) : (
                <>
                  <TransactionHeader t={selected.transaction} />
                  <TransactionFacts t={selected.transaction} className={INSPECTOR_LIST} />
                  <TransactionActions t={selected.transaction} className="border-t-[0.5px] border-separator p-3.5" />
                </>
              )}
            </Card>
          </aside>
        )}
      </div>
    )
  } else {
    content = (
      <>
        {groups.map((g) => (
          <section key={g.date} className="mt-[22px]" aria-label={g.date}>
            <DayHeading group={g} today={today} kind={kind} currency={homeCurrency} className="px-1 pb-2" />
            <List>
              {g.items.map((e) => (
                <SwipeRow
                  key={e.id}
                  leading={{ label: 'Edit', icon: 'pencil-simple', onAction: () => edit(e) }}
                  trailing={{ label: 'Delete', icon: 'trash', onAction: () => remove(e) }}
                >
                  {e.type === 'transfer' ? <TransferRow tr={e.transfer} /> : <TransactionRow t={e.transaction} />}
                </SwipeRow>
              ))}
            </List>
          </section>
        ))}
        <div ref={loadMoreRef} aria-hidden className="h-px" />
        {list.isFetchingNextPage && <SkeletonRows count={2} variant="double" className="mt-3" />}
      </>
    )
  }

  return (
    <Screen
      title="Activity"
      eyebrow={monthName}
      context={monthName}
      topBarActions={
        <GlassButton
          icon="sliders-horizontal"
          label={activeFilters ? `Filter, ${activeFilters} active` : 'Filter'}
          onClick={() => setFilterOpen(true)}
          className={cn(activeFilters > 0 && 'text-tint-text')}
        />
      }
    >
      <div className="flex flex-col gap-3 lg:mb-4 lg:flex-row lg:items-center">
        {!isRegular && <CompactSearch q={q} onChange={(v) => update({ q: v || undefined })} />}
        <Segmented<KindFilter>
          aria-label="Show"
          options={KIND_OPTIONS}
          value={kind ?? 'all'}
          onChange={(v) => update({ kind: v === 'all' ? undefined : v, category: undefined })}
          className="lg:h-8 lg:w-[280px] lg:[&>button]:text-callout"
        />
        {isRegular && (
          <div className="ml-auto flex gap-2">
            <FilterMenu
              allLabel="All Categories"
              value={categoryId}
              options={filterCategories.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => update({ category: v })}
            />
            <FilterMenu
              allLabel="All Accounts"
              value={accountId}
              options={accountItems.map((a) => ({ value: a.id, label: a.name }))}
              onChange={(v) => update({ account: v })}
            />
          </div>
        )}
      </div>

      {status && (
        <div className="mt-3 flex lg:mt-0 lg:mb-4">
          <button
            type="button"
            onClick={() => update({ status: undefined })}
            className="pressable inline-flex h-8 items-center gap-1.5 rounded-full bg-tint-soft px-3 text-subhead font-semibold text-tint-text"
            aria-label={`Showing ${STATUS_LABELS[status].toLowerCase()} only. Show All`}
          >
            {STATUS_LABELS[status]}
            <Icon name="x" weight="bold" size={13} aria-hidden />
          </button>
        </div>
      )}

      {content}

      <FilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        categories={filterCategories}
        accounts={accountItems}
        categoryId={categoryId}
        accountId={accountId}
        onChange={(f) => update({ category: f.categoryId, account: f.accountId })}
      />
    </Screen>
  )
}

/** Compact search: debounced through the URL (?q=), recent searches when focused and empty. */
function CompactSearch({ q, onChange }: { q: string; onChange: (q: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [recent, setRecent] = useState<string[]>(readRecentSearches)
  const showRecent = focused && !q && recent.length > 0

  return (
    <div>
      <SearchField
        label="Search transactions"
        value={q}
        onValueChange={onChange}
        data-search-field="activity"
        onFocus={() => {
          setRecent(readRecentSearches())
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
          if (q.trim()) setRecent(addRecentSearch(q))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (q.trim()) setRecent(addRecentSearch(q))
            e.currentTarget.blur()
          }
        }}
      />
      {showRecent && (
        <section aria-label="Recent searches" className="mt-3">
          <div className="flex items-baseline justify-between px-1 pb-2">
            <h2 className="m-0 text-headline">Recent Searches</h2>
            <button
              type="button"
              className="-my-2 py-2 pl-3 text-subhead text-tint-text"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                clearRecentSearches()
                setRecent([])
              }}
            >
              Clear
            </button>
          </div>
          <List>
            {recent.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(s)}
                className="ui-row ui-row--plain relative flex min-h-11 w-full items-center gap-3 px-4 py-[11px] text-left text-body active:bg-fill-4"
              >
                <Icon name="clock" className="text-[17px] text-label-2" />
                <span className="truncate">{s}</span>
              </button>
            ))}
          </List>
        </section>
      )}
    </div>
  )
}

/** Desktop filter pop-up: "All Categories ⌃⌄". */
function FilterMenu({
  allLabel,
  value,
  options,
  onChange,
}: {
  allLabel: string
  value: string | undefined
  options: { value: string; label: string }[]
  onChange: (value: string | undefined) => void
}) {
  const current = options.find((o) => o.value === value)
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${allLabel.replace('All ', '')}: ${current?.label ?? allLabel}`}
        className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-surface pr-2.5 pl-3 text-body text-label shadow-card hover:bg-fill-4 data-popup-open:bg-fill-4"
      >
        {current?.label ?? allLabel}
        <Icon name="caret-up-down" className="text-[12px] text-label-2" />
      </Menu.Trigger>
      <MenuPopup align="end" className="max-h-[60vh] overflow-y-auto">
        <MenuRadioGroup value={value ?? ''} onValueChange={(v) => onChange((v as string) || undefined)}>
          <MenuRadioItem value="">{allLabel}</MenuRadioItem>
          {options.map((o) => (
            <MenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu.Root>
  )
}

/** Loading shape for compact: a day header and two-line rows. */
function CompactSkeleton() {
  return (
    <div className="mt-[22px]">
      <div className="flex justify-between px-1 pb-3">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="h-3.5 w-24" />
      </div>
      <SkeletonRows count={5} variant="double" label="Loading transactions" />
    </div>
  )
}
