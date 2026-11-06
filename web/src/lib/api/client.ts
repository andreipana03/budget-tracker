import createClient from 'openapi-fetch'

import type { paths } from './schema.gen'

// "/api" goes through the Vite dev proxy to the Go API (see vite.config.ts).
export const apiClient = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
})
