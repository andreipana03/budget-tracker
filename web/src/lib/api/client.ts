import createClient from 'openapi-fetch'

import type { paths } from './schema.gen'
import { API_BASE_URL, getAccessToken, refreshSession } from './session'

// Endpoints that never need (or retry with) an access token.
const PUBLIC_PATH = /\/auth\/(login|register|google|refresh|logout|verify-email|forgot-password|reset-password|username-available)$|\/health$/

/**
 * Adds the bearer token, and when the API answers 401 (expired access token) refreshes
 * the session once and retries the request. If the refresh fails the session is cleared
 * and the guard sends the person to Sign In.
 */
async function authFetch(request: Request): Promise<Response> {
  const isPublic = PUBLIC_PATH.test(new URL(request.url, window.location.origin).pathname)
  const retry = isPublic ? null : request.clone()
  const token = getAccessToken()
  if (token && !isPublic) request.headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(request)
  if (response.status !== 401 || !retry) return response

  const refreshed = await refreshSession().catch(() => false)
  if (!refreshed) return response
  retry.headers.set('Authorization', `Bearer ${getAccessToken()}`)
  return fetch(retry)
}

// "/api" goes through the Vite dev proxy to the Go API (see vite.config.ts), so the
// HttpOnly refresh cookie is same-origin.
export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  credentials: 'include',
  fetch: authFetch,
})
