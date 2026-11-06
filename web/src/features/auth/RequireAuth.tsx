// PLACEHOLDER — W-auth replaces this with the real guard (redirect to /sign-in when signed out).
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'

/** Route guard for the signed-in app. Renders `children` or the nested routes. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  return children ?? <Outlet />
}
