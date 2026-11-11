import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/queries'
import type { components } from '@/lib/api/schema.gen'

export type Home = components['schemas']['Home']
export type BudgetLine = components['schemas']['BudgetLine']
export type BudgetMonth = components['schemas']['BudgetMonth']

/**
 * Everything Home shows for a budget month (GET /home?month=). The server computes every
 * number (left, per day, pace, ranking); the screen only formats them. The previous
 * month stays on screen while another one loads.
 */
export function useHome(month: string | undefined) {
  return useQuery({
    queryKey: queryKeys.home(month ?? 'current'),
    queryFn: ({ signal }) => unwrap(apiClient.GET('/home', { params: { query: month ? { month } : {} }, signal })),
    placeholderData: keepPreviousData,
  })
}
