import { useTransferSheet } from '@/app/transfer-sheet'
import { Button } from '@/components/ui/Button'
import { DetailRow } from '@/components/ui/FormRows'
import { List } from '@/components/ui/List'
import { Money } from '@/components/ui/Money'
import { useHousehold } from '@/lib/api/queries'
import { formatDateTime, formatMediumDate, formatMoney, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TransferTile } from './TransferRow'
import { impliedRate, isExchange, rateText, transferSpokenTitle, transferTitle, type Transfer } from './transfers'
import { useTransferActions } from './useTransfers'

/**
 * The header of the inspector / detail screen for a transfer: 52px ⇄ tile, "ING Card →
 * Cash", what left in SF Rounded title-1 and, between currencies, what arrived with the
 * rate it works out to: "40,10 € arrived · 1 € = 4,99 lei".
 */
export function TransferHeader({ tr, hideTitle, className }: { tr: Transfer; hideTitle?: boolean; className?: string }) {
  const region = useRegion()
  const exchange = isExchange(tr)
  const rate = exchange ? impliedRate(tr.fromAmountMinor, tr.fromAccount.currency, tr.toAmountMinor, tr.toAccount.currency) : null
  const rateLine = rate ? rateText(rate, tr.fromAccount.currency, tr.toAccount.currency, { region }) : null
  return (
    <div className={cn('flex flex-col items-center px-[18px] pt-[22px] pb-[18px] text-center', className)}>
      <TransferTile size={52} />
      {!hideTitle && (
        <p className="m-0 mt-2 text-headline">
          <span aria-hidden>{transferTitle(tr)}</span>
          <span className="sr-only">Transfer from {transferSpokenTitle(tr)}</span>
        </p>
      )}
      <p className="m-0 mt-2.5 font-rounded text-title-1 font-bold">
        <Money minor={tr.fromAmountMinor} currency={tr.fromAccount.currency} />
      </p>
      {exchange && (
        <p className="m-0 mt-0.5 text-callout text-label-2 tabular-nums">
          {formatMoney(tr.toAmountMinor, tr.toAccount.currency, { region })} arrived
          {rateLine && ` · ${rateLine}`}
        </p>
      )}
    </div>
  )
}

/** From · To · Date · Note, as a flush list. */
export function TransferFacts({ tr, className }: { tr: Transfer; className?: string }) {
  const household = useHousehold()
  const home = household.data?.homeCurrency
  const date = tr.occurredAt ? formatDateTime(tr.occurredAt, household.data?.timezone) : formatMediumDate(tr.occurredOn)
  const account = (a: Transfer['fromAccount']) => (home && a.currency !== home ? `${a.name} · ${a.currency}` : a.name)
  return (
    <List className={className}>
      <DetailRow label="From" value={account(tr.fromAccount)} accessory="none" />
      <DetailRow label="To" value={account(tr.toAccount)} accessory="none" />
      <DetailRow label="Date" value={date} accessory="none" />
      <DetailRow label="Note" value={tr.note || 'None'} accessory="none" />
    </List>
  )
}

/** Edit (opens the Transfer sheet) and Delete (immediate, with an Undo toast). */
export function TransferActions({
  tr,
  onDeleted,
  layout = 'inspector',
  className,
}: {
  tr: Transfer
  onDeleted?: () => void
  layout?: 'inspector' | 'page'
  className?: string
}) {
  const transferSheet = useTransferSheet()
  const actions = useTransferActions()
  const page = layout === 'page'
  const size = page ? 'regular' : 'small'
  return (
    <div className={cn('flex gap-2', page && 'flex-col', className)}>
      <Button
        size={size}
        variant="secondary"
        icon="pencil-simple"
        onClick={() => transferSheet.open({ transferId: tr.id })}
        className={cn(!page && 'flex-1')}
      >
        {page ? 'Edit Transfer' : 'Edit'}
      </Button>
      <Button
        size={size}
        variant="destructive"
        icon="trash"
        onClick={() => {
          void actions.remove(tr)
          onDeleted?.()
        }}
        className={cn(!page && 'flex-1')}
      >
        {page ? 'Delete Transfer' : 'Delete'}
      </Button>
    </div>
  )
}
