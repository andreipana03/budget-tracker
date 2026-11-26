import { Fragment, useEffect, useRef } from 'react'

import { CategoryTile } from '@/components/ui/CategoryTile'
import { Icon } from '@/components/ui/Icon'
import { List } from '@/components/ui/List'
import { Money } from '@/components/ui/Money'
import { rowClasses } from '@/components/ui/row-classes'
import { SkeletonBlock } from '@/components/ui/States'
import { hueVar } from '@/lib/categories'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TransferAmount, TransferArrived, TransferTile } from '@/features/transfers/TransferRow'
import { transferSpokenTitle, transferTitle, type Transfer } from '@/features/transfers/transfers'

import { DayHeading } from './DayHeading'
import { StatusPill, TransactionAmount } from './TransactionRow'
import { isForeign, type ActivityEntry, type DayGroup, type EntryKind, type Transaction } from './transactions'

const COLS = 'grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_64px_132px] gap-3'

/**
 * Desktop Activity table (design § 6.12): Merchant (tile + name + note) · Category
 * (dot + name) · Account · Time · Amount, grouped by day. Transfers sit in the same
 * order: "ING Card → Cash", category "Transfer", the account the money left. One
 * selected row in `tint-soft`; the page handles ↑↓ / Return / ⌫. Click selects,
 * double-click edits.
 */
export function ActivityTable({
  groups,
  selectedId,
  onSelect,
  onOpen,
  today,
  timezone,
  kind,
  currency,
}: {
  groups: DayGroup[]
  selectedId: string | undefined
  onSelect: (e: ActivityEntry) => void
  onOpen: (e: ActivityEntry) => void
  today: string
  timezone?: string
  kind?: EntryKind
  /** Home currency for the day totals. */
  currency?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the selection in view when it moves by keyboard.
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tx-id="${selectedId}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  return (
    <List
      ref={listRef}
      role="listbox"
      aria-label="Transactions"
      tabIndex={0}
      aria-activedescendant={selectedId ? `tx-${selectedId}` : undefined}
      className="outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--tint)_55%,transparent)]"
    >
      <div role="presentation" className={cn('grid border-b-[0.5px] border-separator px-3.5 py-2 text-footnote font-semibold text-label-2', COLS)}>
        <span>Merchant</span>
        <span>Category</span>
        <span>Account</span>
        <span>Time</span>
        <span className="text-right">Amount</span>
      </div>
      {groups.map((g) => (
        <Fragment key={g.date}>
          <DayHeading
            group={g}
            today={today}
            kind={kind}
            currency={currency}
            className="border-b-[0.5px] border-separator px-3.5 pt-3.5 pb-1.5"
          />
          {g.items.map((e) =>
            e.type === 'transfer' ? (
              <TransferTableRow
                key={e.id}
                tr={e.transfer}
                selected={e.id === selectedId}
                onSelect={() => onSelect(e)}
                onOpen={() => onOpen(e)}
                timezone={timezone}
              />
            ) : (
              <TableRow
                key={e.id}
                t={e.transaction}
                selected={e.id === selectedId}
                onSelect={() => onSelect(e)}
                onOpen={() => onOpen(e)}
                timezone={timezone}
              />
            ),
          )}
        </Fragment>
      ))}
    </List>
  )
}

function TableRow({
  t,
  selected,
  onSelect,
  onOpen,
  timezone,
}: {
  t: Transaction
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  timezone?: string
}) {
  return (
    <div
      id={`tx-${t.id}`}
      data-tx-id={t.id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        rowClasses({ size: 'double', interactive: true, selected }),
        'grid scroll-mt-[124px] scroll-mb-4 [--sep-inset:14px]',
        COLS,
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <CategoryTile color={t.category.color} icon={t.category.icon} size={40} />
        <span className="min-w-0">
          <span className="block truncate text-body font-semibold">
            {t.title}
            <StatusPill status={t.status} />
          </span>
          <span className="flex min-w-0 items-center gap-1 text-callout text-label-2">
            {t.recurringId && <Icon name="arrows-clockwise" label="Repeats" className="flex-none text-[13px]" />}
            <span className="truncate">{t.note || t.account.name}</span>
          </span>
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2 text-body">
        <i aria-hidden className="size-2 flex-none rounded-full" style={{ background: hueVar(t.category.color) }} />
        <span className="truncate">{t.category.name}</span>
      </span>
      <span className="truncate text-body text-label-2">{t.account.name}</span>
      <span className="text-body text-label-2 tabular-nums">{t.occurredAt ? formatTime(t.occurredAt, timezone) : '—'}</span>
      <span className="flex flex-col items-end text-right text-body">
        <TransactionAmount t={t} />
        {isForeign(t) && <Money minor={t.homeAmountMinor} currency={t.homeCurrency} className="text-callout text-label-2" />}
      </span>
    </div>
  )
}

/** A transfer in the table: ⇄ tile, "ING Card → Cash" + note · "Transfer" · from-account · time · amount. */
function TransferTableRow({
  tr,
  selected,
  onSelect,
  onOpen,
  timezone,
}: {
  tr: Transfer
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  timezone?: string
}) {
  return (
    <div
      id={`tx-${tr.id}`}
      data-tx-id={tr.id}
      role="option"
      aria-selected={selected}
      aria-label={`Transfer from ${transferSpokenTitle(tr)}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        rowClasses({ size: 'double', interactive: true, selected }),
        'grid scroll-mt-[124px] scroll-mb-4 [--sep-inset:14px]',
        COLS,
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <TransferTile size={40} />
        <span className="min-w-0">
          <span className="block truncate text-body font-semibold">{transferTitle(tr)}</span>
          {tr.note && <span className="block truncate text-callout text-label-2">{tr.note}</span>}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2 text-body">
        <i aria-hidden className="size-2 flex-none rounded-full bg-label-3" />
        <span className="truncate">Transfer</span>
      </span>
      <span className="truncate text-body text-label-2">{tr.fromAccount.name}</span>
      <span className="text-body text-label-2 tabular-nums">{tr.occurredAt ? formatTime(tr.occurredAt, timezone) : '—'}</span>
      <span className="flex flex-col items-end text-right text-body">
        <TransferAmount tr={tr} />
        <TransferArrived tr={tr} className="text-callout text-label-2" />
      </span>
    </div>
  )
}

/** Loading shape of the table: header, a day header and rows. */
export function ActivityTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <List aria-busy>
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div aria-hidden className={cn('grid border-b-[0.5px] border-separator px-3.5 py-2', COLS)}>
        {['w-16', 'w-16', 'w-14', 'w-10', 'w-14'].map((w, i) => (
          <SkeletonBlock key={i} className={cn('h-3', w, i === 4 && 'justify-self-end')} />
        ))}
      </div>
      <div aria-hidden className="border-b-[0.5px] border-separator px-3.5 pt-3.5 pb-2">
        <SkeletonBlock className="h-3.5 w-40" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className={cn(rowClasses({ size: 'double' }), 'grid [--sep-inset:14px]', COLS)}>
          <span className="flex items-center gap-3">
            <SkeletonBlock className="size-9 rounded-[9px]" />
            <span className="flex flex-col gap-1.5">
              <SkeletonBlock className={cn('h-3.5', i % 2 ? 'w-24' : 'w-32')} />
              <SkeletonBlock className="h-3 w-20" />
            </span>
          </span>
          <SkeletonBlock className="h-3.5 w-24" />
          <SkeletonBlock className="h-3.5 w-16" />
          <SkeletonBlock className="h-3.5 w-10" />
          <SkeletonBlock className="h-3.5 w-16 justify-self-end" />
        </div>
      ))}
    </List>
  )
}
