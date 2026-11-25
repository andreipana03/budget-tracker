import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'

import { SheetPresenceContext } from '@/components/ui/sheet-presence'
import { AddSheetHost } from '@/features/add/AddSheetHost'
import { cn } from '@/lib/utils'

import { useAddSheet } from './add-sheet'
import { SECTIONS, TABS, tabRootIndex } from './nav'
import { PageFrame } from './PageFrame'
import { PagePeek } from './PagePeek'
import { usePageSwipe } from './page-swipe'
import { isCompactViewport } from './page-transitions'
import { ShellContext } from './shell-context'
import { useGlobalShortcuts } from './shortcuts'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { loadTabPage } from './tab-pages'

const SIDEBAR_PREF = 'bt.sidebarHidden'

function readSidebarPref(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PREF) === '1'
  } catch {
    return false
  }
}

/** Focus the first visible search field (a screen's own `[data-search-field]` wins over the toolbar's). */
function focusVisibleSearch(): boolean {
  const fields = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-search-field]'))
  const visible = fields.filter((f) => f.getClientRects().length > 0)
  const target = visible.find((f) => f.dataset.searchField !== 'toolbar') ?? visible[0]
  if (!target) return false
  target.focus()
  target.select()
  return true
}

/**
 * The app frame (design § 5): floating glass sidebar ≥ 1024, floating tab bar +
 * Add button below; one scroller for screens with scroll-edge bands; the global
 * Add sheet; keyboard shortcuts. While a compact sheet is open the page recedes.
 * Screens render through <Outlet /> and use <Screen> for their chrome.
 * Compact: tab screens swipe sideways (page-swipe.ts, with the neighbour in <PagePeek>);
 * every other navigation slides as a View Transition (page-transitions.ts).
 */
export function AppShell() {
  const shellRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [peek, setPeek] = useState<number | null>(null)
  const [sidebarHidden, setSidebarHidden] = useState(readSidebarPref)
  const [sheetCount, setSheetCount] = useState(0)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const addSheet = useAddSheet()

  const toggleSidebar = useCallback(() => {
    setSidebarHidden((h) => {
      try {
        localStorage.setItem(SIDEBAR_PREF, h ? '0' : '1')
      } catch {
        // private mode: keep it in memory only
      }
      return !h
    })
  }, [])

  const reportSheet = useCallback((delta: 1 | -1) => setSheetCount((n) => Math.max(0, n + delta)), [])

  const swipe = usePageSwipe({
    pageRef,
    shellRef,
    index: tabRootIndex(pathname),
    count: TABS.length,
    disabled: sheetCount > 0,
    onPeek: setPeek,
    onCommit: (i) => navigate(TABS[i].path, { viewTransition: false }),
  })

  // New screen → start at the top; after a swipe, drop the peek in the same frame the real page
  // appears. The swiped-to page already grew its bars in the peek: don't grow them again.
  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    const swiped = swipe.settle()
    pageRef.current?.toggleAttribute('data-swiped', swiped)
  }, [pathname, swipe])

  // Have the tab screens ready so a swipe can show its neighbour straight away.
  useEffect(() => {
    if (!isCompactViewport()) return
    const id = window.setTimeout(() => TABS.forEach((t) => void loadTabPage(t.id)), 1200)
    return () => window.clearTimeout(id)
  }, [])

  useGlobalShortcuts({
    onAdd: () => addSheet.open(),
    onSection: (i) => navigate(SECTIONS[i].path),
    onSearch: () => {
      if (!focusVisibleSearch()) navigate('/activity')
    },
    onToggleSidebar: toggleSidebar,
  })

  const shell = useMemo(() => ({ scrollerRef, sidebarHidden, toggleSidebar }), [sidebarHidden, toggleSidebar])

  return (
    <ShellContext.Provider value={shell}>
      <SheetPresenceContext.Provider value={reportSheet}>
        <div ref={shellRef} className="app-shell fixed inset-0 overflow-hidden bg-bg" data-sheet-open={sheetCount > 0 || undefined}>
          <Sidebar hidden={sidebarHidden} onHide={toggleSidebar} />
          <div ref={pageRef} className={cn('app-main absolute inset-0 bg-bg', !sidebarHidden && 'lg:left-[calc(var(--sidebar-w)+10px)]')}>
            <PageFrame scrollerRef={scrollerRef}>
              <Outlet />
            </PageFrame>
          </div>
          {peek != null && <PagePeek key={peek} index={peek} peekRef={swipe.attachPeek} />}
          <TabBar />
          <AddSheetHost />
        </div>
      </SheetPresenceContext.Provider>
    </ShellContext.Provider>
  )
}
