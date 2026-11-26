import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { useToast } from '@/components/ui/use-toast'
import type { TransactionPage } from '@/features/activity/transactions'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'
import { invalidateMoney, queryKeys } from '@/lib/api/queries'

import type { Transfer } from './transfers'

/** One transfer (detail screen, Edit sheet). */
export function useTransfer(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.transfer(id ?? ''),
    queryFn: () => unwrap(apiClient.GET('/transfers/{id}', { params: { path: { id: id! } } })),
    enabled: Boolean(id),
  })
}

/** Drop a transfer from every cached Activity page right away. */
function removeFromCaches(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<InfiniteData<TransactionPage> | TransactionPage>({ queryKey: ['transactions'] }, (old) => {
    if (!old || !('pages' in old)) return old
    return { ...old, pages: old.pages.map((p) => (p.transfers ? { ...p, transfers: p.transfers.filter((t) => t.id !== id) } : p)) }
  })
}

/**
 * Delete a transfer (with Undo), shared by Activity, the inspector and the detail screen.
 * Every write refreshes every money screen (invalidateMoney), so balances move at once.
 *
 *   const actions = useTransferActions()
 *   await actions.remove(tr)    // row disappears, toast "Transfer deleted · Undo" for 5 s
 */
export function useTransferActions() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const restore = useCallback(
    async (tr: Transfer) => {
      try {
        await unwrap(apiClient.POST('/transfers/{id}/restore', { params: { path: { id: tr.id } } }))
      } catch {
        toast.show({ title: 'Couldn’t restore this transfer' })
      }
      await invalidateMoney(queryClient)
    },
    [queryClient, toast],
  )

  /** Soft delete right away; the toast offers Undo for 5 s. Resolves false if the delete failed. */
  const remove = useCallback(
    async (tr: Transfer): Promise<boolean> => {
      removeFromCaches(queryClient, tr.id)
      try {
        await unwrap(apiClient.DELETE('/transfers/{id}', { params: { path: { id: tr.id } } }))
      } catch (e) {
        await invalidateMoney(queryClient)
        // Already gone (another device) counts as deleted.
        if (!(e instanceof ApiError && e.status === 404)) {
          toast.show({ title: 'Couldn’t delete this transfer' })
          return false
        }
      }
      queryClient.removeQueries({ queryKey: queryKeys.transfer(tr.id) })
      void invalidateMoney(queryClient)
      toast.show({ title: 'Transfer deleted', action: { label: 'Undo', onClick: () => void restore(tr) } })
      return true
    },
    [queryClient, toast, restore],
  )

  return useMemo(() => ({ remove, restore }), [remove, restore])
}
