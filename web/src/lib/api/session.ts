/**
 * The signed-in session, outside React so the API client can use it.
 *
 * - The access token (15-minute JWT) lives only in memory.
 * - The refresh token lives in an HttpOnly cookie the page can't read; POST /auth/refresh
 *   with that cookie returns a fresh access token (and rotates the cookie).
 * - Refreshes are single-flight in this tab and serialized across tabs (Web Locks), so
 *   two refreshes never race with the same cookie.
 *
 * React reads it through `useAuth()` (features/auth/AuthProvider).
 */
import type { components } from './schema.gen'

export type AuthResponse = components['schemas']['AuthResponse']
export type SessionUser = components['schemas']['User']
export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut'
export type SessionSnapshot = { status: SessionStatus; user: SessionUser | null }

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api'

let accessToken: string | null = null
let snapshot: SessionSnapshot = { status: 'unknown', user: null }
const listeners = new Set<() => void>()

function emit(next: SessionSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot
}

export function getAccessToken(): string | null {
  return accessToken
}

/** Store what /auth/login, /auth/register, /auth/google or /auth/refresh returned. */
export function applyAuthResponse(response: AuthResponse) {
  accessToken = response.accessToken
  emit({ status: 'signedIn', user: response.user })
}

/** Update the cached user (after PATCH /me) without touching the token. */
export function updateSessionUser(user: SessionUser) {
  if (snapshot.status === 'signedIn') emit({ status: 'signedIn', user })
}

export function clearSession() {
  accessToken = null
  if (snapshot.status !== 'signedOut' || snapshot.user) emit({ status: 'signedOut', user: null })
}

let inFlight: Promise<boolean> | null = null

/**
 * Get a new access token with the refresh cookie. Resolves true when signed in,
 * false when the session is gone (and clears it). Throws on network errors.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= runRefresh().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runRefresh(): Promise<boolean> {
  const attempt = async () => {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'web' }),
    })
    if (response.ok) {
      applyAuthResponse((await response.json()) as AuthResponse)
      return true
    }
    if (response.status >= 400 && response.status < 500) {
      clearSession()
      return false
    }
    throw new Error(`refresh failed with ${response.status}`)
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks?.request ? locks.request('budget-tracker-refresh', attempt) : attempt()
}
