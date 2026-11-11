import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router'

import { Screen } from '@/app/Screen'
import { ConfirmDialog, DetailRow, InlineError, List, Section, SectionFooter, SkeletonRows, useToast } from '@/components/ui'
import { useAuth } from '@/features/auth/auth-context'
import { errorMessage } from '@/features/auth/field-errors'
import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import { useAccounts, useCategories, useHousehold, useMe } from '@/lib/api/queries'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'

import { version } from '../../../package.json'
import { AccountsPage } from './AccountsPage'
import { BudgetSection } from './BudgetSection'
import { CategoriesPage } from './CategoriesPage'
import { ActionRow, ListError } from './parts'
import { ProfileSection } from './ProfileSection'
import { SecuritySection } from './SecuritySection'
import { SETTINGS_COLUMN } from './settings-logic'

/**
 * Settings (/settings/*). Compact: pushed from Home's profile button (Back to Home).
 * Regular: the sidebar's Settings item. Accounts and Categories are pushed sub-screens.
 */
export function SettingsPage() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="accounts" element={<AccountsPage />} />
      <Route path="categories" element={<CategoriesPage />} />
      <Route path="*" element={<SettingsHome />} />
    </Routes>
  )
}

function SettingsHome() {
  const regular = useIsRegular()
  const me = useMe()
  const household = useHousehold()
  const accounts = useAccounts({ includeArchived: true })
  const categories = useCategories()

  const activeAccounts = accounts.data?.items.filter((a) => !a.archived).length
  const loading = me.isPending || household.isPending

  return (
    <Screen title="Settings" back={regular ? undefined : { to: '/', label: 'Back to Home' }} hideToolbarActions>
      <div className={SETTINGS_COLUMN}>
        {me.isError || household.isError ? (
          <InlineError
            what="your settings"
            onRetry={() => {
              void me.refetch()
              void household.refetch()
            }}
          />
        ) : loading ? (
          <>
            <SkeletonRows count={3} />
            <SkeletonRows count={2} />
            <SkeletonRows count={4} />
          </>
        ) : (
          <>
            <ProfileSection user={me.data} />
            <SecuritySection user={me.data} />
            <BudgetSection household={household.data} user={me.data} />
            <Section title="Accounts & Categories">
              <List>
                <DetailRow
                  label="Accounts"
                  value={activeAccounts === undefined ? undefined : String(activeAccounts)}
                  to="/settings/accounts"
                />
                <DetailRow
                  label="Categories"
                  value={categories.data ? String(categories.data.length) : undefined}
                  to="/settings/categories"
                />
              </List>
            </Section>
            <SessionGroups />
          </>
        )}
        <p className="m-0 pb-2 text-center text-footnote text-label-2">Budget Tracker {version}</p>
      </div>
    </Screen>
  )
}

/** Sign Out, then Delete Account (irreversible: the one place an alert is right). */
function SessionGroups() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOutNow = async () => {
    setBusy(true)
    await signOut()
    navigate('/sign-in', { replace: true })
  }

  const deleteAccount = async () => {
    setConfirming(false)
    setBusy(true)
    setError(null)
    try {
      await unwrap(apiClient.DELETE('/me'))
      await signOut()
      queryClient.clear()
      navigate('/sign-in', { replace: true })
      toast.show({ title: 'Account deleted' })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <>
      <List>
        <ActionRow destructive onClick={signOutNow} disabled={busy}>
          Sign Out
        </ActionRow>
      </List>
      <div>
        <List>
          <ActionRow destructive onClick={() => setConfirming(true)} disabled={busy}>
            Delete Account
          </ActionRow>
        </List>
        {error ? (
          <ListError>{error}</ListError>
        ) : (
          <SectionFooter>Deletes your budgets, transactions, accounts and categories for good.</SectionFooter>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete your account?"
        message="Your budgets, transactions, accounts and categories will be deleted. This can’t be undone."
        confirmLabel="Delete Account"
        destructive
        onConfirm={deleteAccount}
      />
    </>
  )
}
