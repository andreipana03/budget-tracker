import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api/client'
import { queryKeys, unwrap } from '@/lib/api/queries'

import type { InsightsPeriod } from './insights-text'

/** GET /insights?period= — bars, headline, by category and highlights (server-computed). */
export function useInsights(period: InsightsPeriod) {
  return useQuery({
    queryKey: queryKeys.insights(period),
    queryFn: () => unwrap(apiClient.GET('/insights', { params: { query: { period } } })),
    placeholderData: keepPreviousData,
  })
}
