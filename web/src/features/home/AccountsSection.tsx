import { ButtonLink } from '@/components/ui/Button'
import { Card, List, Row } from '@/components/ui/List'
import { Money } from '@/components/ui/Money'
import { Section } from '@/components/ui/Section'
import { InlineError, SkeletonRows } from '@/components/ui/States'
import { AccountTile } from '@/features/settings/parts'
import { accountIcon } from '@/lib/account-icon'
import { useAccounts } from '@/lib/api/queries'

import { accountsFooter } from './home-text'

/**
 * Home › Accounts (compact and medium only; at ≥1024 the sidebar shows the same
 * group). One single-line row per active account (tile · name · balance in its own
 * currency) and a Total row with the ≈ total in the home currency, as in the sidebar.
 * A row opens Activity filtered to that account.
 */
export function AccountsSection() {
  const accounts = useAccounts()
  const data = accounts.data
  const active = data?.items.filter((a) => !a.archived) ?? []

  return (
    <Section
      title="Accounts"
      footer={data && active.length > 0 ? accountsFooter(data) : undefined}
    >
      {accounts.isError ? (
        <InlineError what="your accounts" onRetry={() => void accounts.refetch()} />
      ) : !data ? (
        <SkeletonRows count={3} />
      ) : active.length === 0 ? (
        <Card className="px-4 py-3.5 text-subhead text-label-2">
          No accounts yet.{' '}
          <ButtonLink to="/settings/accounts" variant="plain" size="small" className="-my-2 h-auto px-0">
            Add Account
          </ButtonLink>
        </Card>
      ) : (
        <List>
          {active.map((a) => (
            <Row
              key={a.id}
              leading={<AccountTile icon={accountIcon(a, data.homeCurrency)} />}
              title={a.name}
              trailing={<Money minor={a.balanceMinor} currency={a.currency} />}
              to={`/activity?account=${a.id}`}
            />
          ))}
          <Row
            title="Total"
            trailing={
              <Money
                minor={data.totalHomeMinor}
                currency={data.homeCurrency}
                approx={data.totalIsApproximate}
                className="font-semibold text-label"
              />
            }
          />
        </List>
      )}
    </Section>
  )
}
