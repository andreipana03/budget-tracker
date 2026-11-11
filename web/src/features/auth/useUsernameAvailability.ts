import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'

/** Same rule as the API: 3–30 of a–z 0–9 . _ - (compared lowercased). */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/

/** What people type → what gets stored: lowercase, no spaces. */
export function normalizeUsernameInput(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

export type UsernameState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'unavailable'; message: string }
  | { status: 'error' }

export const USERNAME_MESSAGES = {
  invalid: 'Use 3–30 letters, numbers, dots, dashes or underscores.',
  taken: 'This username is taken. Try another one.',
  reserved: 'This username isn’t available. Try another one.',
} as const

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/**
 * Live, debounced username check (GET /auth/username-available). Format problems
 * show at once, without a request; `current` (Settings) counts as fine.
 */
export function useUsernameAvailability(username: string, { current }: { current?: string } = {}): UsernameState {
  const value = normalizeUsernameInput(username)
  const debounced = useDebounced(value, 350)
  const formatOk = USERNAME_PATTERN.test(value)
  const unchanged = current !== undefined && value === current
  const query = useQuery({
    queryKey: ['username-available', debounced],
    queryFn: ({ signal }) =>
      unwrap(apiClient.GET('/auth/username-available', { params: { query: { username: debounced } }, signal })),
    enabled: USERNAME_PATTERN.test(debounced) && debounced !== current,
    staleTime: 15_000,
    retry: false,
  })

  if (!value || unchanged) return { status: 'idle' }
  // Don't nag while the first characters are being typed.
  if (!formatOk) return value.length < 3 && /^[a-z0-9._-]*$/.test(value) ? { status: 'idle' } : { status: 'unavailable', message: USERNAME_MESSAGES.invalid }
  if (debounced !== value || query.isPending) return { status: 'checking' }
  if (query.isError) return { status: 'error' }
  const data = query.data
  if (data.available) return { status: 'available' }
  return { status: 'unavailable', message: USERNAME_MESSAGES[data.reason ?? 'taken'] }
}
