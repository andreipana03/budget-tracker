import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'

import { SheetPresenceContext } from '@/components/ui/sheet-presence'
import { AddSheetHost } from '@/features/add/AddSheetHost'
import { cn } from '@/lib/utils'

import { useAddSheet } from './add-sheet'
import { SECTIONS } from './nav'
import { ShellContext } from './shell-context'
import { useGlobalShortcuts } from './shortcuts'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'

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
 */
export function AppShell() {
  const scrollerRef = useRef<HTMLDivElement>(null)
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

  // New screen → start at the top.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }, [pathname])

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
        <div className="app-shell fixed inset-0 overflow-hidden bg-bg" data-sheet-open={sheetCount > 0 || undefined}>
          <Sidebar hidden={sidebarHidden} onHide={toggleSidebar} />
          <div className={cn('app-main absolute inset-0 bg-bg', !sidebarHidden && 'lg:left-[calc(var(--sidebar-w)+10px)]')}>
            <main
              ref={scrollerRef}
              className="ui-scroller absolute inset-0 overflow-y-auto overscroll-contain pt-[calc(var(--safe-top)+46px)] pb-[calc(var(--safe-bottom)+var(--tabbar-h)+40px)] lg:pt-0 lg:pb-12"
            >
              <Outlet />
            </main>
            <div aria-hidden className="scroll-edge-top app-chrome absolute inset-x-0 top-0 z-15 h-[calc(var(--safe-top)+60px)] lg:h-[76px]" />
            <div
              aria-hidden
              className="scroll-edge-bottom app-chrome absolute inset-x-0 bottom-0 z-15 h-[calc(var(--safe-bottom)+var(--tabbar-h)+28px)] lg:hidden"
            />
          </div>
          <TabBar />
          <AddSheetHost />
        </div>
      </SheetPresenceContext.Provider>
    </ShellContext.Provider>
  )
}
