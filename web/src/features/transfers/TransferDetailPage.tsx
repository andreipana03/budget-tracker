import { useNavigate, useParams } from 'react-router'

import { Screen } from '@/app/Screen'
import { Card } from '@/components/ui/List'
import { EmptyState, InlineError, SkeletonBlock, SkeletonRows } from '@/components/ui/States'
import { ApiError } from '@/lib/api/errors'

import { TransferActions, TransferFacts, TransferHeader } from './TransferDetails'
import { transferTitle } from './transfers'
import { useTransfer } from './useTransfers'

/**
 * Transfer detail (/activity/transfers/:id; compact push from Activity, works on desktop
 * too). Mirrors the desktop inspector: header with what left and what arrived, the facts
 * list, then Edit / Delete.
 */
export function TransferDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const transfer = useTransfer(id)
  const back = { to: '/activity', label: 'Back to Activity' }

  if (transfer.isPending) {
    return (
      <Screen title="Transfer" back={back}>
        <Card className="flex flex-col items-center gap-3 px-5 py-6" aria-busy>
          <SkeletonBlock className="size-12 rounded-[13px]" />
          <SkeletonBlock className="h-7 w-36" />
        </Card>
        <SkeletonRows count={4} className="mt-5" />
      </Screen>
    )
  }

  if (transfer.isError || !transfer.data) {
    const missing = transfer.error instanceof ApiError && transfer.error.status === 404
    return (
      <Screen title="Transfer" back={back}>
        {missing ? (
          <Card>
            <EmptyState
              icon="arrows-left-right"
              title="Transfer Not Found"
              message="It may have been deleted on another device."
              action={{ label: 'Go to Activity', onClick: () => navigate('/activity') }}
            />
          </Card>
        ) : (
          <InlineError what="this transfer" onRetry={() => void transfer.refetch()} />
        )}
      </Screen>
    )
  }

  const tr = transfer.data
  return (
    <Screen title={transferTitle(tr)} back={back}>
      <div className="mx-auto flex max-w-[560px] flex-col gap-5">
        <Card>
          <TransferHeader tr={tr} hideTitle />
        </Card>
        <TransferFacts tr={tr} />
        <TransferActions tr={tr} layout="page" onDeleted={() => navigate('/activity')} />
      </div>
    </Screen>
  )
}
