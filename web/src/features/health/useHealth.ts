import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api/client'

const REFRESH_INTERVAL_MS = 10_000

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/health')
      // A 503 is still a valid health report, so it comes back as data here.
      const health = data ?? error
      if (!health) throw new Error('The API returned an empty health response')
      return health
    },
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  })
}
