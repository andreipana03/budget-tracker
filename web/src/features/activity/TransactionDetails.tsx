import { useState } from 'react'

import { useAddSheet } from '@/app/add-sheet'
import { Button } from '@/components/ui/Button'
import { CategoryTile } from '@/components/ui/CategoryTile'
import { DetailRow } from '@/components/ui/FormRows'
import { List } from '@/components/ui/List'
import { Money } from '@/components/ui/Money'
import { useHousehold, useSubscriptions } from '@/lib/api/queries'
import {
  currencySymbol,
  decimalSeparator,
  formatDateTime,
  formatMediumDate,
  formatMoney,
  useRegion,
} from '@/lib/format'
import { cn } from '@/lib/utils'

import { StatusPill } from './TransactionRow'
import { formatRate, isForeign, kindNoun, repeatLabel, type Transaction } from './transactions'
import { useTransactionActions } from './useTransactionActions'

function useRepeat(t: Transaction): string {
  const subs = useSubscriptions()
  if (!t.recurringId) return 'Never'
  const all = subs.data ? [...subs.data.nextSevenDays, ...subs.data.later, ...subs.data.paused] : []
  const s = all.find((x) => x.id === t.recurringId)
  return s ? repeatLabel(s) : 'Repeats'
}

/**
 * The header of the inspector / detail screen (design § 6.13): 52px tile, title,
 * amount in SF Rounded title-1 and, for foreign currencies, the conversion line
 * "49,75 lei · 1 € = 4,98 lei on 17 Nov".
 */
export function TransactionHeader({ t, hideTitle, className }: { t: Transaction; hideTitle?: boolean; className?: string }) {
  const region = useRegion()
  const foreign = isForeign(t)
  return (
    <div className={cn('flex flex-col items-center px-[18px] pt-[22px] pb-[18px] text-center', className)}>
      <CategoryTile color={t.category.color} icon={t.category.icon} size={52} />
      {hideTitle ? (
        t.status !== 'posted' && <StatusPill status={t.status} className="mt-2 ml-0" />
      ) : (
        <p className="m-0 mt-2 text-headline">
          {t.title}
          <StatusPill status={t.status} />
        </p>
      )}
      <p className="m-0 mt-2.5 font-rounded text-title-1 font-bold">
        <Money minor={t.amountMinor} currency={t.currency} kind={t.kind} />
      </p>
      {foreign && (
        <p className="m-0 mt-0.5 text-callout text-label-2 tabular-nums">
          {formatMoney(t.homeAmountMinor, t.homeCurrency, { region })} · 1 {currencySymbol(t.currency, { region })} ={' '}
          {formatRate(t.fxRate, decimalSeparator({ region }))} {currencySymbol(t.homeCurrency, { region })}
          {t.fxRateDate && ` on ${formatMediumDate(t.fxRateDate).replace(/ \d{4}$/, '')}`}
        </p>
      )}
    </div>
  )
}

/** Category · Account · Date · Note · Repeat, as a flush list. */
export function TransactionFacts({ t, className }: { t: Transaction; className?: string }) {
  const household = useHousehold()
  const repeat = useRepeat(t)
  const home = household.data?.homeCurrency ?? t.homeCurrency
  const date = t.occurredAt ? formatDateTime(t.occurredAt, household.data?.timezone) : formatMediumDate(t.occurredOn)
  return (
    <List className={className}>
      <DetailRow
        label="Category"
        value={t.category.name}
        valueLeading={<CategoryTile color={t.category.color} icon={t.category.icon} size={20} />}
        accessory="none"
      />
      <DetailRow
        label="Account"
        value={t.account.currency !== home ? `${t.account.name} · ${t.account.currency}` : t.account.name}
        accessory="none"
      />
      <DetailRow label="Date" value={date} accessory="none" />
      <DetailRow label="Note" value={t.note || 'None'} accessory="none" />
      <DetailRow label="Repeat" value={repeat} accessory="none" />
    </List>
  )
}

/**
 * Edit / Delete (and Confirm Payment / Skip This Time for pending charges). Delete is
 * immediate with an Undo toast.
 */
export function TransactionActions({
  t,
  onDeleted,
  layout = 'inspector',
  className,
}: {
  t: Transaction
  onDeleted?: () => void
  layout?: 'inspector' | 'page'
  className?: string
}) {
  const addSheet = useAddSheet()
  const actions = useTransactionActions()
  const [busy, setBusy] = useState<'confirm' | 'skip' | null>(null)
  const page = layout === 'page'
  const size = page ? 'regular' : 'small'

  const run = async (kind: 'confirm' | 'skip') => {
    setBusy(kind)
    await actions[kind](t)
    setBusy(null)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {t.status === 'pending' && (
        <div className={cn('flex gap-2', page && 'flex-col')}>
          <Button
            size={size}
            icon="check"
            disabled={busy != null}
            onClick={() => void run('confirm')}
            className={cn('bg-tint-soft text-tint-text hover:bg-tint-soft hover:brightness-95', !page && 'flex-1')}
          >
            Confirm Payment
          </Button>
          <Button size={size} variant="secondary" disabled={busy != null} onClick={() => void run('skip')} className={cn(!page && 'flex-1')}>
            Skip This Time
          </Button>
        </div>
      )}
      <div className={cn('flex gap-2', page && 'flex-col')}>
        <Button
          size={size}
          variant="secondary"
          icon="pencil-simple"
          onClick={() => addSheet.open({ transactionId: t.id, kind: t.kind })}
          className={cn(!page && 'flex-1')}
        >
          {page ? `Edit ${kindNoun(t.kind)}` : 'Edit'}
        </Button>
        <Button
          size={size}
          variant="destructive"
          icon="trash"
          onClick={() => {
            void actions.remove(t)
            onDeleted?.()
          }}
          className={cn(!page && 'flex-1')}
        >
          {page ? `Delete ${kindNoun(t.kind)}` : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
