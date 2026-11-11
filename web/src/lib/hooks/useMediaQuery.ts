import { useSyncExternalStore } from 'react'

/**
 * Subscribe to a media query. Prefer CSS (`lg:` classes) for layout; use this only
 * when the component tree itself differs (e.g. a table on desktop vs. rows on compact).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** ≥ 1024px: the regular (sidebar + toolbar) layout. */
export function useIsRegular(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
