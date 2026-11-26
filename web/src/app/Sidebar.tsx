import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

import { Icon, type IconName } from '@/components/ui/Icon'
import { SkeletonBlock } from '@/components/ui/States'
import { accountIcon } from '@/lib/account-icon'
import { useAccounts, useSubscriptions } from '@/lib/api/queries'
import { formatMoney, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { SECTIONS, sectionForPath, sectionShortcut } from './nav'
import { SHORTCUTS } from './shortcuts'
import { useTransferSheet } from './transfer-sheet'

const ITEM =
  'flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-body text-label hover:bg-fill-4 ' +
  'aria-[current=page]:bg-glass-selected aria-[current=page]:font-semibold aria-[current=page]:hover:bg-glass-selected'

function SidebarItem({
  to,
  icon,
  current,
  shortcut,
  children,
  trailing,
}: {
  to: string
  icon: IconName
  current?: boolean
  shortcut?: string
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <Link to={to} className={ITEM} aria-current={current ? 'page' : undefined} aria-keyshortcuts={shortcut}>
      <Icon name={icon} variant="sidebar" className="text-tint" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  )
}

/**
 * Regular-width navigation (design § 5.2, § 5.4): floating glass-strong sidebar,
 * 244px, 10px from the window edges. Sections with ⌘1–5, Subscriptions badge
 * (pending + due in 7 days), Accounts with balances, the ≈ total and "Transfer" (T) on
 * the group's header row, Settings at the bottom. Degrades quietly while data is
 * loading or unavailable.
 */
export function Sidebar({ hidden, onHide }: { hidden: boolean; onHide: () => void }) {
  const { pathname } = useLocation()
  const region = useRegion()
  const section = pathname.startsWith('/settings') ? null : sectionForPath(pathname)
  const accounts = useAccounts()
  const transferSheet = useTransferSheet()
  const subs = useSubscriptions()
  const badge = subs.data ? subs.data.pendingCount + subs.data.nextSevenDays.length : 0

  return (
    <aside
      aria-label="Sidebar"
      hidden={hidden}
      className="glass glass-strong fixed top-2.5 bottom-2.5 left-2.5 z-40 hidden w-(--sidebar-w) flex-col overflow-y-auto rounded-[22px] px-2.5 py-3 lg:flex"
    >
      <div className="flex items-center justify-between pt-0.5 pr-1 pb-2.5 pl-2">
        <span className="flex items-center gap-2 text-headline">
          <img src="/favicon.svg" width={22} height={22} alt="" className="rounded-[5px]" />
          Budget Tracker
        </span>
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide Sidebar"
          aria-keyshortcuts={SHORTCUTS.sidebar.keys}
          title={`Hide Sidebar (${SHORTCUTS.sidebar.hint})`}
          className="grid size-8 place-items-center rounded-sm text-[17px] text-label-2 hover:bg-fill-4"
        >
          <Icon name="sidebar-simple" />
        </button>
      </div>

      <nav aria-label="Sections" className="flex flex-col gap-px">
        {SECTIONS.map((s, i) => (
          <SidebarItem
            key={s.id}
            to={s.path}
            icon={s.icon}
            current={section === s.id}
            shortcut={sectionShortcut(i + 1)}
            trailing={
              s.id === 'subscriptions' && badge > 0 ? (
                <span
                  className="grid h-5 min-w-5 place-items-center rounded-[10px] bg-fill-2 px-1.5 text-caption-1 font-semibold text-label-2"
                  aria-label={`${badge} need attention`}
                >
                  {badge}
                </span>
              ) : null
            }
          >
            {s.label}
          </SidebarItem>
        ))}
      </nav>

      {!accounts.isError && (
        <section aria-labelledby="sidebar-accounts">
          <div className="mt-4 mb-1 flex items-baseline justify-between gap-2 px-2.5">
            <h2 id="sidebar-accounts" className="m-0 text-footnote font-bold tracking-[0.01em] text-label-2">
              Accounts
            </h2>
            {accounts.data?.items.some((a) => !a.archived) && (
              <button
                type="button"
                onClick={() => transferSheet.open()}
                aria-label="Transfer Between Accounts"
                aria-keyshortcuts={SHORTCUTS.transfer.keys}
                title={`Transfer Between Accounts (${SHORTCUTS.transfer.hint})`}
                className="-my-1 rounded-[6px] px-1.5 py-1 text-footnote text-tint-text hover:bg-fill-4"
              >
                Transfer
              </button>
            )}
          </div>
          {accounts.isPending ? (
            <div className="flex flex-col gap-3 px-2.5 py-2" aria-hidden>
              <SkeletonBlock className="h-3 w-40" />
              <SkeletonBlock className="h-3 w-32" />
              <SkeletonBlock className="h-3 w-36" />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-px">
                {accounts.data.items
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <SidebarItem
                      key={a.id}
                      to={`/activity?account=${a.id}`}
                      icon={accountIcon(a, accounts.data.homeCurrency)}
                      trailing={
                        <span className="text-subhead whitespace-nowrap text-label-2 tabular-nums">
                          {formatMoney(a.balanceMinor, a.currency, { region })}
                        </span>
                      }
                    >
                      {a.name}
                    </SidebarItem>
                  ))}
              </div>
              {accounts.data.items.length > 0 && (
                <div className="flex justify-between px-2.5 pt-1.5 pb-0.5 text-footnote text-label-2 tabular-nums">
                  <span>Total</span>
                  <span>
                    {formatMoney(accounts.data.totalHomeMinor, accounts.data.homeCurrency, {
                      region,
                      approx: accounts.data.totalIsApproximate,
                    })}
                  </span>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <div className="min-h-4 flex-1" />
      <div className={cn('flex flex-col gap-px')}>
        <SidebarItem to="/settings" icon="gear" current={pathname.startsWith('/settings')}>
          Settings
        </SidebarItem>
      </div>
    </aside>
  )
}
