import { useState } from 'react'
import { useNavigate } from 'react-router'

import { CategoryTile } from '@/components/ui/CategoryTile'
import { Icon } from '@/components/ui/Icon'
import { Row } from '@/components/ui/List'
import { Menu, MenuItem, MenuPopup } from '@/components/ui/Menu'
import { Money } from '@/components/ui/Money'
import { rowClasses } from '@/components/ui/row-classes'
import type { Subscription } from '@/lib/api/queries'
import { dueParts, formatDay } from '@/lib/format'
import { cn } from '@/lib/utils'

import { repeatLabel, type Transaction } from '@/features/activity/transactions'
import { useTransactionActions } from '@/features/activity/useTransactionActions'

/** Group label above the pending rows inside the Upcoming list. */
export function WaitingHeader() {
  return (
    <p className="m-0 px-4 pt-3 pb-0.5 text-footnote font-semibold text-label-2 lg:px-3.5 lg:pt-2.5">Waiting for You</p>
  )
}

/**
 * A subscription charge waiting for confirmation (under "Waiting for You"): monogram
 * tile, title, "25,00 lei · Yesterday", a trailing Confirm button and a ⋯ menu with
 * Skip This Time and Details. Pending charges never count as spent until confirmed.
 */
export function PendingRow({ t, today }: { t: Transaction; today: string }) {
  const actions = useTransactionActions()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const run = async (kind: 'confirm' | 'skip') => {
    setBusy(true)
    await actions[kind](t)
    setBusy(false)
  }

  return (
    <div className={cn(rowClasses({ size: 'double' }), 'pr-2 lg:pr-2')} role="group" aria-label={`${t.title}, waiting for you`}>
      <CategoryTile color={t.category.color} monogram={t.title} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold">{t.title}</span>
        <span className="block truncate text-subhead text-label-2 lg:text-callout">
          <Money minor={t.amountMinor} currency={t.currency} kind={t.kind} tone={false} /> · {formatDay(t.occurredOn, today)}
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run('confirm')}
        className="pressable h-8 flex-none rounded-full bg-tint-soft px-3.5 text-subhead font-semibold text-tint-text disabled:opacity-40 lg:h-7 lg:px-3 lg:text-body"
      >
        Confirm
      </button>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`More for ${t.title}`}
          disabled={busy}
          className="grid size-11 flex-none place-items-center rounded-full text-[20px] text-label-2 hover:bg-fill-4 data-popup-open:bg-fill-4 lg:size-8"
        >
          <Icon name="dots-three" weight="bold" />
        </Menu.Trigger>
        <MenuPopup align="end">
          <MenuItem icon="x" onClick={() => void run('skip')}>
            Skip This Time
          </MenuItem>
          <MenuItem icon="info" onClick={() => navigate(`/activity/${t.id}`)}>
            Details
          </MenuItem>
        </MenuPopup>
      </Menu.Root>
    </div>
  )
}

/**
 * An upcoming subscription charge: monogram tile in the category color, "In 3 days ·
 * Sat 21 Nov" (the relative part emphasized within the next 7 days), the amount and
 * the cadence — or the ≈ home value for foreign currencies.
 */
export function SubscriptionRow({ s, today, homeCurrency }: { s: Subscription; today: string; homeCurrency: string }) {
  const due = dueParts(s.nextDueOn, today)
  const soon = due.relative && s.daysUntilDue >= 0 && s.daysUntilDue <= 7
  return (
    <Row
      leading={<CategoryTile color={s.category.color} monogram={s.title} size={40} />}
      title={s.title}
      subtitle={
        soon ? (
          <span className="truncate">
            <span className="font-semibold text-label">{due.relative}</span> · {due.date}
          </span>
        ) : (
          due.date
        )
      }
      trailing={<Money minor={s.amountMinor} currency={s.currency} kind={s.kind} />}
      trailingSub={
        s.currency !== homeCurrency && s.amountHomeMinor != null ? (
          <Money minor={s.amountHomeMinor} currency={homeCurrency} approx />
        ) : (
          repeatLabel(s)
        )
      }
      to="/subscriptions"
    />
  )
}
