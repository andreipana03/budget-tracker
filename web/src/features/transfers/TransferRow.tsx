import { Icon } from '@/components/ui/Icon'
import { Row } from '@/components/ui/List'
import { Money } from '@/components/ui/Money'
import { cn } from '@/lib/utils'

import { isExchange, transferSpokenTitle, transferTitle, type Transfer } from './transfers'

type TransferTileSize = 20 | 40 | 52

const TILE: Record<TransferTileSize, string> = {
  20: 'size-5 rounded-xs text-[12px]',
  40: 'size-10 rounded-[11px] text-[22px] lg:size-9 lg:rounded-[9px] lg:text-[20px]',
  52: 'size-12 rounded-[13px] text-[26px] lg:size-[52px] lg:text-[28px]',
}

/**
 * Neutral tile for a transfer (⇄). Transfers aren't a category, so they get no category
 * hue: the same quiet fill as account tiles. Decorative, like every tile.
 */
export function TransferTile({ size = 40, className }: { size?: TransferTileSize; className?: string }) {
  return (
    <span aria-hidden className={cn('grid flex-none place-items-center bg-fill-3 text-label-2', TILE[size], className)}>
      <Icon name="arrows-left-right" weight="bold" />
    </span>
  )
}

/** What left the source account ("200,00 lei"). No sign: a transfer is neither spent nor received. */
export function TransferAmount({ tr, className }: { tr: Transfer; className?: string }) {
  return <Money minor={tr.fromAmountMinor} currency={tr.fromAccount.currency} className={className} />
}

/** Between currencies, what arrived: "→ 40,10 €". */
export function TransferArrived({ tr, className }: { tr: Transfer; className?: string }) {
  if (!isExchange(tr)) return null
  return (
    <span className={cn('tabular-nums whitespace-nowrap', className)}>
      <span aria-hidden>→ </span>
      <span className="sr-only">arrived as </span>
      <Money minor={tr.toAmountMinor} currency={tr.toAccount.currency} />
    </span>
  )
}

/** "Transfer" or "Transfer · ATM withdrawal": the category slot of a transaction row. */
export function TransferSubtitle({ tr }: { tr: Transfer }) {
  return <span className="truncate">{tr.note ? `Transfer · ${tr.note}` : 'Transfer'}</span>
}

/**
 * Two-line transfer row in Activity (design § 6.5): neutral ⇄ tile · "ING Card → Cash" ·
 * "Transfer · note" · the amount that left, and what arrived below it between currencies.
 * Links to the transfer's detail screen.
 */
export function TransferRow({ tr, to = `/activity/transfers/${tr.id}`, className }: { tr: Transfer; to?: string; className?: string }) {
  return (
    <Row
      leading={<TransferTile size={40} />}
      title={
        <>
          <span aria-hidden>{transferTitle(tr)}</span>
          <span className="sr-only">Transfer from {transferSpokenTitle(tr)}</span>
        </>
      }
      subtitle={<TransferSubtitle tr={tr} />}
      trailing={<TransferAmount tr={tr} />}
      trailingSub={isExchange(tr) ? <TransferArrived tr={tr} /> : undefined}
      to={to}
      className={className}
    />
  )
}
