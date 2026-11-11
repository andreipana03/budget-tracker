import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/queries'

import type { EntryKind, TransactionPage } from './transactions'

export type TransactionStatus = 'posted' | 'pending' | 'skipped'

export interface TransactionFilters {
  kind?: EntryKind
  status?: TransactionStatus
  categoryId?: string
  accountId?: string
  q?: string
}

const PAGE_SIZE = 50

/** Only the keys that are set, so equal filters share one cache entry. */
function cleanFilters(f: TransactionFilters): TransactionFilters {
  const out: TransactionFilters = {}
  if (f.kind) out.kind = f.kind
  if (f.status) out.status = f.status
  if (f.categoryId) out.categoryId = f.categoryId
  if (f.accountId) out.accountId = f.accountId
  if (f.q?.trim()) out.q = f.q.trim()
  return out
}

/**
 * Activity's list: GET /transactions a page at a time (keyset cursor), newest first.
 * Keeps the previous results on screen while a new search or filter loads.
 */
export function useTransactions(filters: TransactionFilters) {
  const f = cleanFilters(filters)
  return useInfiniteQuery({
    queryKey: queryKeys.transactions({ ...f }),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        apiClient.GET('/transactions', {
          params: { query: { ...f, cursor: pageParam, limit: PAGE_SIZE } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TransactionPage) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

/** One transaction (detail screen, Edit sheet). */
export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.transaction(id ?? ''),
    queryFn: () => unwrap(apiClient.GET('/transactions/{id}', { params: { path: { id: id! } } })),
    enabled: Boolean(id),
  })
}

/** The latest 20 transactions of a kind — the Add sheet's defaults come from these. */
export function useRecentOfKind(kind: EntryKind, enabled = true) {
  return useQuery({
    queryKey: queryKeys.transactions({ kind, limit: 20, purpose: 'add-defaults' }),
    queryFn: () => unwrap(apiClient.GET('/transactions', { params: { query: { kind, limit: 20 } } })),
    enabled,
    staleTime: 60_000,
  })
}
