/**
 * Where to go after signing in. `next` comes from the URL, so anyone can craft it:
 * only same-origin paths are allowed, never "//evil.com", "/\evil.com", "javascript:"
 * or a URL with a scheme. The auth pages themselves fall back to Home (no loops).
 *
 *   safeNext('/budgets?month=2026-11') → '/budgets?month=2026-11'
 *   safeNext('https://evil.com')       → '/'
 */
const BASE = 'https://app.invalid'
const AUTH_PAGES = /^\/(sign-in|sign-up|forgot-password|reset-password|verify-email)(\/|$)/

export function safeNext(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback
  // Must be a path. Browsers treat "\" like "/" and drop tabs/newlines, so "/\evil.com"
  // and "/\t/evil.com" would both become "//evil.com": reject them outright.
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback
  if (AUTH_PAGES.test(url.pathname)) return fallback
  return url.pathname + url.search + url.hash
}
