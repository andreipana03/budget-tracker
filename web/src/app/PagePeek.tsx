import { Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from 'react'
import { NavigationType, UNSAFE_LocationContext, type Location } from 'react-router'

import { SheetPresenceContext } from '@/components/ui/sheet-presence'

import { TABS } from './nav'
import { PageFrame } from './PageFrame'
import { ShellContext, type ShellState } from './shell-context'
import { loadedTabPage, loadTabPage } from './tab-pages'

/**
 * The neighbour tab, rendered live beside the current page while a finger drags it
 * (page-swipe.ts positions it). It sees its own location (the tab's path, like a tab tap
 * would open), its own scroller, and is inert: no focus, no taps, no document title.
 */
export function PagePeek({ index, peekRef }: { index: number; peekRef: Ref<HTMLDivElement> }) {
  const tab = TABS[index]
  const [Page, setPage] = useState<ComponentType | undefined>(() => loadedTabPage(tab.id))
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (Page) return
    let live = true
    void loadTabPage(tab.id).then((C) => live && setPage(() => C))
    return () => {
      live = false
    }
  }, [Page, tab.id])

  const shell = useMemo<ShellState>(() => ({ scrollerRef, sidebarHidden: false, toggleSidebar: () => {}, peek: true }), [])
  const location = useMemo(
    () => ({
      location: { pathname: tab.path, search: '', hash: '', state: null, key: 'peek' } satisfies Location,
      navigationType: NavigationType.Pop,
    }),
    [tab.path],
  )

  return (
    <div ref={peekRef} aria-hidden inert className="absolute inset-0 overflow-hidden bg-bg lg:hidden">
      <ShellContext.Provider value={shell}>
        <SheetPresenceContext.Provider value={null}>
          <UNSAFE_LocationContext.Provider value={location}>
            <PageFrame scrollerRef={scrollerRef}>
              <Suspense fallback={null}>{Page && <Page />}</Suspense>
            </PageFrame>
          </UNSAFE_LocationContext.Provider>
        </SheetPresenceContext.Provider>
      </ShellContext.Provider>
    </div>
  )
}
