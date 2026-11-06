import { useNavigate, useParams } from 'react-router'

import { Screen } from '@/app/Screen'
import { Card } from '@/components/ui/List'
import { EmptyState, InlineError, SkeletonBlock, SkeletonRows } from '@/components/ui/States'
import { ApiError } from '@/lib/api/errors'

import { TransactionActions, TransactionFacts, TransactionHeader } from './TransactionDetails'
import { useTransaction } from './useTransactions'

/**
 * Transaction detail (compact push from Activity / Home; works on desktop too). Mirrors
 * the desktop inspector: header with the amount and conversion, the facts list, then
 * Edit / Delete (and Confirm Payment / Skip This Time for pending charges).
 */
export function TransactionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const tx = useTransaction(id)
  const back = { to: '/activity', label: 'Back to Activity' }

  if (tx.isPending) {
    return (
      <Screen title="Transaction" back={back}>
        <Card className="flex flex-col items-center gap-3 px-5 py-6" aria-busy>
          <SkeletonBlock className="size-12 rounded-[13px]" />
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="h-7 w-36" />
        </Card>
        <SkeletonRows count={5} className="mt-5" />
      </Screen>
    )
  }

  if (tx.isError || !tx.data) {
    const missing = tx.error instanceof ApiError && tx.error.status === 404
    return (
      <Screen title="Transaction" back={back}>
        {missing ? (
          <Card>
            <EmptyState
              icon="receipt"
              title="Transaction Not Found"
              message="It may have been deleted on another device."
              action={{ label: 'Go to Activity', onClick: () => navigate('/activity') }}
            />
          </Card>
        ) : (
          <InlineError what="this transaction" onRetry={() => void tx.refetch()} />
        )}
      </Screen>
    )
  }

  const t = tx.data
  return (
    <Screen title={t.title} back={back}>
      <div className="mx-auto flex max-w-[560px] flex-col gap-5">
        <Card>
          <TransactionHeader t={t} hideTitle />
        </Card>
        <TransactionFacts t={t} />
        <TransactionActions t={t} layout="page" onDeleted={() => navigate('/activity')} />
      </div>
    </Screen>
  )
}
