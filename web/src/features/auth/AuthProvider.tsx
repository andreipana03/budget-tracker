import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import { apiClient } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/queries'
import {
  applyAuthResponse,
  clearSession,
  getSessionSnapshot,
  refreshSession,
  subscribeSession,
  updateSessionUser,
  type AuthResponse,
} from '@/lib/api/session'

import { AuthContext, type AuthContextValue } from './auth-context'

/**
 * Restores the session on load (POST /auth/refresh with the HttpOnly cookie) and exposes
 * it through `useAuth()`. Wrap the app once, inside the QueryClientProvider.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { status, user } = useSyncExternalStore(subscribeSession, getSessionSnapshot)

  useEffect(() => {
    // Single-flight, so React StrictMode's double effect sends one request.
    if (getSessionSnapshot().status === 'unknown') refreshSession().catch(() => clearSession())
  }, [])

  useEffect(() => {
    if (user) queryClient.setQueryData(queryKeys.me, user)
  }, [queryClient, user])

  const signIn = useCallback(
    (response: AuthResponse) => {
      queryClient.clear()
      applyAuthResponse(response)
    },
    [queryClient],
  )

  const signOut = useCallback(async () => {
    await apiClient.POST('/auth/logout', { body: {} }).catch(() => undefined)
    clearSession()
    queryClient.clear()
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signOut, updateUser: updateSessionUser }),
    [status, user, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
