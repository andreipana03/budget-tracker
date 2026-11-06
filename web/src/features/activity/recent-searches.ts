/**
 * Recent Activity searches, per browser (a convenience, so localStorage is fine).
 * Every access is guarded: private mode or blocked storage just means no history.
 */
const KEY = 'bt.recentSearches'
const MAX = 5

export function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

/** Put `q` first (case-insensitive dedupe), keep the newest five. Returns the new list. */
export function addRecentSearch(q: string): string[] {
  const term = q.trim()
  if (!term) return readRecentSearches()
  const next = [term, ...readRecentSearches().filter((s) => s.toLowerCase() !== term.toLowerCase())].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage unavailable: keep it for this render only
  }
  return next
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
