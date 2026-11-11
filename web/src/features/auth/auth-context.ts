import { createContext, useContext } from 'react'

import type { AuthResponse, SessionStatus, SessionUser } from '@/lib/api/session'

export type AuthContextValue = {
  /** 'unknown' while the saved session is being restored on load. */
  status: SessionStatus
  user: SessionUser | null
  /** Call with the AuthResponse of login / register / Google. */
  signIn: (response: AuthResponse) => void
  /** Revokes this device's session and forgets cached data. */
  signOut: () => Promise<void>
  /** Keep the session's user in sync after PATCH /me. */
  updateUser: (user: SessionUser) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
