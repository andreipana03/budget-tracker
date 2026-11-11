import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { useAuth } from './auth-context'

/**
 * Route guard for the signed-in app: waits while the session is restored, sends signed-out
 * people to Sign In (and back here afterwards via ?next=), otherwise renders the routes.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'unknown') return <div className="min-h-dvh bg-bg" aria-busy="true" />
  if (status === 'signedOut') {
    const next = location.pathname + location.search
    return <Navigate to={next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`} replace />
  }
  return children ?? <Outlet />
}
