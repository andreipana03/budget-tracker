import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/queries'

/** Budget months with data (next month back to the first), newest first, with spent and budget. */
export function useMonths(enabled = true) {
  return useQuery({
    queryKey: queryKeys.months,
    queryFn: () => unwrap(apiClient.GET('/months')),
    enabled,
  })
}
