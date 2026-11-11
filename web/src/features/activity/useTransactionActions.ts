import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { useToast } from '@/components/ui/use-toast'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'
import { invalidateMoney, queryKeys } from '@/lib/api/queries'
import type { components } from '@/lib/api/schema.gen'

import { kindNoun, type Transaction, type TransactionPage } from './transactions'

type Home = components['schemas']['Home']

/** Drop a transaction from every cached list right away (Activity pages, Add defaults, Home). */
function removeFromCaches(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<InfiniteData<TransactionPage> | TransactionPage>({ queryKey: ['transactions'] }, (old) => {
    if (!old) return old
    if ('pages' in old) return { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((t) => t.id !== id) })) }
    if ('items' in old) return { ...old, items: old.items.filter((t) => t.id !== id) }
    return old
  })
  queryClient.setQueriesData<Home>({ queryKey: ['home'] }, (old) =>
    old ? { ...old, recent: old.recent.filter((t) => t.id !== id), pending: old.pending.filter((t) => t.id !== id) } : old,
  )
}

/**
 * Delete (with Undo), confirm and skip — the writes Activity, the detail screen, the
 * inspector and Home share. Every write refreshes every money screen (invalidateMoney).
 *
 *   const actions = useTransactionActions()
 *   await actions.remove(tx)    // row disappears, toast "Expense deleted · Undo" for 5 s
 */
export function useTransactionActions() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const restore = useCallback(
    async (t: Transaction) => {
      try {
        await unwrap(apiClient.POST('/transactions/{id}/restore', { params: { path: { id: t.id } } }))
      } catch {
        toast.show({ title: `Couldn’t restore this ${kindNoun(t.kind).toLowerCase()}` })
      }
      await invalidateMoney(queryClient)
    },
    [queryClient, toast],
  )

  /** Soft delete right away; the toast offers Undo for 5 s. Resolves false if the delete failed. */
  const remove = useCallback(
    async (t: Transaction): Promise<boolean> => {
      const noun = kindNoun(t.kind)
      removeFromCaches(queryClient, t.id)
      try {
        await unwrap(apiClient.DELETE('/transactions/{id}', { params: { path: { id: t.id } } }))
      } catch (e) {
        await invalidateMoney(queryClient)
        // Already gone (another device) counts as deleted.
        if (!(e instanceof ApiError && e.status === 404)) {
          toast.show({ title: `Couldn’t delete this ${noun.toLowerCase()}` })
          return false
        }
      }
      queryClient.removeQueries({ queryKey: queryKeys.transaction(t.id) })
      void invalidateMoney(queryClient)
      toast.show({ title: `${noun} deleted`, action: { label: 'Undo', onClick: () => void restore(t) } })
      return true
    },
    [queryClient, toast, restore],
  )

  const confirm = useCallback(
    async (t: Transaction): Promise<boolean> => {
      try {
        await unwrap(apiClient.POST('/transactions/{id}/confirm', { params: { path: { id: t.id } }, body: {} }))
        toast.show({ title: 'Payment confirmed' })
        return true
      } catch (e) {
        toast.show({ title: e instanceof ApiError && e.code === 'not_pending' ? 'This payment was already handled' : 'Couldn’t confirm this payment' })
        return false
      } finally {
        await invalidateMoney(queryClient)
      }
    },
    [queryClient, toast],
  )

  const skip = useCallback(
    async (t: Transaction): Promise<boolean> => {
      try {
        await unwrap(apiClient.POST('/transactions/{id}/skip', { params: { path: { id: t.id } } }))
        toast.show({ title: 'Payment skipped' })
        return true
      } catch (e) {
        toast.show({ title: e instanceof ApiError && e.code === 'not_pending' ? 'This payment was already handled' : 'Couldn’t skip this payment' })
        return false
      } finally {
        await invalidateMoney(queryClient)
      }
    },
    [queryClient, toast],
  )

  return useMemo(() => ({ remove, restore, confirm, skip }), [remove, restore, confirm, skip])
}
