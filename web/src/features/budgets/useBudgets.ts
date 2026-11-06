import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api/client'
import { invalidateMoney, queryKeys, unwrap } from '@/lib/api/queries'
import type { components } from '@/lib/api/schema.gen'

export type SetBudgetsRequest = components['schemas']['SetBudgetsRequest']
export type Transaction = components['schemas']['Transaction']

/** GET /budgets?month= — limits, spending and pace for every expense category (server-computed). */
export function useBudgetMonth(month: string | undefined) {
  return useQuery({
    queryKey: queryKeys.budgets(month ?? 'current'),
    queryFn: () => unwrap(apiClient.GET('/budgets', { params: { query: month ? { month } : {} } })),
    placeholderData: keepPreviousData,
  })
}

/** PUT /budgets, then refresh every screen that shows money. */
export function useSetBudgets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SetBudgetsRequest) => unwrap(apiClient.PUT('/budgets', { body })),
    onSuccess: () => invalidateMoney(queryClient),
  })
}

/** The category's last six months (category detail chart). */
export function useCategoryHistory(categoryId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.insights('six_months', categoryId),
    queryFn: () =>
      unwrap(apiClient.GET('/insights', { params: { query: { period: 'six_months', categoryId: categoryId! } } })),
    enabled: Boolean(categoryId),
  })
}

/** One budget month's transactions in a category (first 50). */
export function useCategoryTransactions(categoryId: string | undefined, month: string | undefined) {
  // `view` keeps this plain query's cache entry apart from Activity's infinite queries.
  const filters = { view: 'category-detail', categoryId, month: month ?? 'current' }
  return useQuery({
    queryKey: queryKeys.transactions(filters),
    queryFn: () =>
      unwrap(
        apiClient.GET('/transactions', {
          params: { query: { categoryId: categoryId!, ...(month ? { month } : {}), limit: 50 } },
        }),
      ),
    enabled: Boolean(categoryId),
  })
}
