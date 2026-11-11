import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { useDebouncedValue } from '@/features/activity/hooks'
import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/queries'

/** The current budget month (same cache entry as Budgets' useBudgetMonth(undefined)). */
export function useCurrentBudgets(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.budgets('current'),
    queryFn: () => unwrap(apiClient.GET('/budgets', { params: { query: {} } })),
    enabled,
  })
}

/**
 * Converts the typed amount to the home currency for the live hint, debounced so a
 * request isn't sent on every keystroke. 422 `fx_rate_unavailable` surfaces as an error.
 */
export function useFxQuote({
  from,
  to,
  on,
  amountMinor,
  enabled,
}: {
  from: string
  to: string
  on: string
  amountMinor: number
  enabled: boolean
}) {
  const amount = useDebouncedValue(amountMinor, 300)
  return useQuery({
    queryKey: ['fx', from, to, on, amount] as const,
    queryFn: ({ signal }) =>
      unwrap(apiClient.GET('/fx/quote', { params: { query: { from, to, on, amountMinor: amount } }, signal })),
    enabled: enabled && from !== to && amount > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
