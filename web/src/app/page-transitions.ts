import type { createBrowserRouter, Location } from 'react-router'

import { tabIndexForPath } from './nav'

/**
 * Compact page transitions (design § 4.7). Every in-app navigation below 1024px runs as a
 * View Transition: React Router snapshots the old screen, commits the new one, and the CSS
 * in app.css (`html[data-page-transition=…]::view-transition-*(page)`) slides between them.
 * The direction comes from where the two screens sit:
 *
 *   forward / back  tab → tab, by tab order (Home · Activity · Budgets · Insights)
 *   push / pop      deeper / shallower in the stack (Activity → Transaction, Settings → Accounts)
 *   fade            same depth, same tab (Settings › Accounts → Settings › Categories)
 *   none            same screen (?month=, ?q=, ?period= changes), auth pages, desktop
 *
 * The finger-driven page swipe (page-swipe.ts) animates on its own and navigates with
 * `viewTransition: false`.
 */
export type PageTransition = 'forward' | 'back' | 'push' | 'pop' | 'fade' | 'none'

const COMPACT_QUERY = '(max-width: 1023.98px)'

export function isCompactViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches
}

/** How deep a signed-in screen sits: 0 = a tab's root, 1+ = pushed. null = not an app screen. */
export function pageDepth(pathname: string): number | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/' || p === '/activity' || p === '/budgets' || p === '/insights') return 0
  if (p === '/subscriptions' || p === '/settings') return 1
  if (/^\/(activity|budgets)\/[^/]+$/.test(p)) return 1
  if (/^\/settings\/.+/.test(p) || p === '/status') return 2
  return null
}

export function transitionBetween(from: string, to: string): PageTransition {
  const a = pageDepth(from)
  const b = pageDepth(to)
  if (from === to || a == null || b == null) return 'none'
  const ta = tabIndexForPath(from)
  const tb = tabIndexForPath(to)
  const byTab: PageTransition = tb > ta ? 'forward' : 'back'
  if (ta !== tb && b === 0) return byTab // a tab tap from anywhere
  if (b > a) return 'push'
  if (b < a) return 'pop'
  return ta !== tb ? byTab : 'fade'
}

/** Rough pathname of a navigation target, for deciding whether it changes screen at all. */
function targetPathname(to: unknown, fromPathname: string): string {
  if (to == null) return fromPathname
  if (typeof to === 'string') {
    if (to === '' || to.startsWith('?') || to.startsWith('#')) return fromPathname
    return new URL(to, `http://x${fromPathname}`).pathname
  }
  if (typeof to === 'object' && 'pathname' in to && typeof to.pathname === 'string') return to.pathname
  return fromPathname
}

// Safari's own edge swipe (Back / Forward) already animates; don't slide again on the popstate it causes.
const EDGE_PX = 24
let edgeTouchAt = -Infinity
let uaTransition = false

type AppRouter = ReturnType<typeof createBrowserRouter>

/** Wire compact page transitions into the app router. Call once, right after createBrowserRouter. */
export function installPageTransitions(router: AppRouter): void {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return

  window.addEventListener(
    'touchstart',
    (e) => {
      const x = e.touches[0]?.clientX ?? EDGE_PX
      if (x < EDGE_PX || x > window.innerWidth - EDGE_PX) edgeTouchAt = performance.now()
    },
    { passive: true, capture: true },
  )
  window.addEventListener(
    'popstate',
    (e) => {
      uaTransition = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true
    },
    { capture: true },
  )

  // Opt every screen-changing navigation in (Links, useNavigate, <Navigate>), unless the caller decided.
  const navigate = router.navigate.bind(router)
  router.navigate = ((to: unknown, opts?: { viewTransition?: boolean }) => {
    if (typeof to === 'number') return navigate(to)
    const from = router.state.location.pathname
    if (opts?.viewTransition === undefined && isCompactViewport()) {
      const path = targetPathname(to, from)
      if (path !== from && pageDepth(path) != null && pageDepth(from) != null) opts = { ...opts, viewTransition: true }
    }
    return navigate(to as Parameters<typeof navigate>[0], opts)
  }) as AppRouter['navigate']

  // Runs before RouterProvider's own subscriber (subscribed earlier), so the direction is on
  // <html> before the old screen is captured. Back/Forward reuse the recorded transitions.
  let current: Location = router.state.location
  router.subscribe((state, { viewTransitionOpts }) => {
    if (state.location === current) return
    const from = current
    current = state.location
    if (!viewTransitionOpts) return
    const fromSafariGesture = state.historyAction === 'POP' && (uaTransition || performance.now() - edgeTouchAt < 2000)
    uaTransition = false
    const kind = !isCompactViewport() || fromSafariGesture ? 'none' : transitionBetween(from.pathname, state.location.pathname)
    document.documentElement.dataset.pageTransition = kind
    if (kind !== 'none') transitionUntil = performance.now() + 450
  })
}

let transitionUntil = 0

/** True while a page transition is (probably) on screen; the page swipe waits for it. */
export function pageTransitionRunning(): boolean {
  return performance.now() < transitionUntil
}
