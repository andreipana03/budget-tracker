import { useState } from 'react'

import { Screen, ToolbarButton, ToolbarGroup } from '@/app/Screen'
import { EmptyState, GlassButton, InlineError, List, Money, Row, Section, SkeletonRows } from '@/components/ui'
import { useAccounts, useHousehold, type Account } from '@/lib/api/queries'

import { AccountSheet } from './AccountSheet'
import { AccountTile } from './parts'
import { accountType, SETTINGS_COLUMN } from './settings-logic'

/** Accounts (/settings/accounts): balances, ≈ total, archived ones apart; add/edit in a sheet. */
export function AccountsPage() {
  const accounts = useAccounts({ includeArchived: true })
  const household = useHousehold()
  const [sheet, setSheet] = useState<{ open: boolean; account: Account | null }>({ open: false, account: null })

  const add = () => setSheet({ open: true, account: null })
  const data = accounts.data
  const active = data?.items.filter((a) => !a.archived) ?? []
  const archived = data?.items.filter((a) => a.archived) ?? []

  const row = (a: Account) => {
    const type = accountType(a.type)
    const foreign = data && a.currency !== data.homeCurrency
    const notes = [type.label, a.currency, a.includeInTotal ? null : 'Not in total'].filter(Boolean).join(' · ')
    return (
      <Row
        key={a.id}
        leading={<AccountTile icon={type.icon} size={40} />}
        title={a.name}
        subtitle={notes}
        trailing={<Money minor={a.balanceMinor} currency={a.currency} />}
        trailingSub={
          foreign && a.balanceHomeMinor !== null && data ? (
            <Money minor={a.balanceHomeMinor} currency={data.homeCurrency} approx />
          ) : undefined
        }
        accessory="disclosure"
        onClick={() => setSheet({ open: true, account: a })}
        aria-label={`${a.name}, ${notes}. Edit Account`}
      />
    )
  }

  return (
    <Screen
      title="Accounts"
      back={{ to: '/settings', label: 'Back to Settings' }}
      hideToolbarActions
      topBarActions={<GlassButton text="Add Account" onClick={add} />}
      toolbarControls={
        <ToolbarGroup>
          <ToolbarButton icon="plus" onClick={add}>
            Add Account
          </ToolbarButton>
        </ToolbarGroup>
      }
    >
      <div className={SETTINGS_COLUMN}>
        {accounts.isError ? (
          <InlineError what="your accounts" onRetry={() => void accounts.refetch()} />
        ) : accounts.isPending ? (
          <SkeletonRows count={3} variant="double" />
        ) : active.length === 0 && archived.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="No Accounts Yet"
            message="Add where your money lives: cash, a bank card or savings."
            action={{ label: 'Add Account', onClick: add, icon: 'plus' }}
          />
        ) : (
          <>
            <Section
              footer={
                data && active.length > 0 ? (
                  <>
                    Total <Money minor={data.totalHomeMinor} currency={data.homeCurrency} approx={data.totalIsApproximate} />
                    {data.totalIsApproximate ? ', with other currencies converted at today’s BNR rate' : ''}. Accounts with
                    Include in Total off aren’t counted.
                  </>
                ) : undefined
              }
            >
              {active.length > 0 ? <List>{active.map(row)}</List> : <p className="m-0 px-4 text-subhead text-label-2">Every account is archived.</p>}
            </Section>
            {archived.length > 0 && (
              <Section title="Archived" footer="Archived accounts keep their history but aren’t offered when you add a transaction.">
                <List>{archived.map(row)}</List>
              </Section>
            )}
          </>
        )}
      </div>

      {household.data && (
        <AccountSheet
          open={sheet.open}
          onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
          account={sheet.account}
          homeCurrency={household.data.homeCurrency}
          today={household.data.today}
        />
      )}
    </Screen>
  )
}
