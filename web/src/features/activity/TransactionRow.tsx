import { CategoryTile } from '@/components/ui/CategoryTile'
import { Icon } from '@/components/ui/Icon'
import { Row } from '@/components/ui/List'
import { Money } from '@/components/ui/Money'
import { Pill } from '@/components/ui/Pill'
import { cn } from '@/lib/utils'

import { isForeign, type Transaction } from './transactions'

/** "Pending" (tinted: it invites an action) or "Skipped" next to the title. */
export function StatusPill({ status, className }: { status: Transaction['status']; className?: string }) {
  if (status === 'posted') return null
  return (
    <Pill tone={status === 'pending' ? 'tint' : 'neutral'} className={cn('ml-1.5', className)}>
      {status === 'pending' ? 'Pending' : 'Skipped'}
    </Pill>
  )
}

/** "Groceries · ING Card", or the note instead of the account; ↻ before it for subscription charges. */
export function TransactionSubtitle({ t, showCategory = true }: { t: Transaction; showCategory?: boolean }) {
  return (
    <>
      {showCategory && <span className="flex-none">{t.category.name} ·</span>}
      {t.recurringId && <Icon name="arrows-clockwise" label="Repeats" className="flex-none text-[13px]" />}
      <span className="truncate">{t.note || t.account.name}</span>
    </>
  )
}

/** Amount as entered ("9,99 €"), income with "+" in green; skipped ones muted. */
export function TransactionAmount({ t, className }: { t: Transaction; className?: string }) {
  return (
    <Money
      minor={t.amountMinor}
      currency={t.currency}
      kind={t.kind}
      className={cn(t.status === 'skipped' && 'text-label-2 line-through', className)}
    />
  )
}

/**
 * Two-line transaction row (design § 6.5): 40px tile · title (+ Pending pill) ·
 * "Category · Account" or the note · amount, with the ≈ home value below for foreign
 * currencies. Links to the detail screen by default.
 */
export function TransactionRow({
  t,
  to = `/activity/${t.id}`,
  className,
}: {
  t: Transaction
  to?: string
  className?: string
}) {
  return (
    <Row
      leading={<CategoryTile color={t.category.color} icon={t.category.icon} size={40} />}
      title={
        <>
          {t.title}
          <StatusPill status={t.status} />
        </>
      }
      subtitle={<TransactionSubtitle t={t} />}
      trailing={<TransactionAmount t={t} />}
      trailingSub={isForeign(t) ? <Money minor={t.homeAmountMinor} currency={t.homeCurrency} /> : undefined}
      to={to}
      className={className}
    />
  )
}
