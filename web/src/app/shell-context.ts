import { createContext, useContext, type RefObject } from 'react'

export interface ShellState {
  /** The app's scrolling element (screens scroll inside it, not the window). */
  scrollerRef: RefObject<HTMLDivElement | null>
  sidebarHidden: boolean
  toggleSidebar: () => void
  /** True inside the page swipe's peek (a neighbour tab rendered beside the page): don't touch the document. */
  peek?: boolean
}

export const ShellContext = createContext<ShellState | null>(null)

/** Shell state for screens; null outside AppShell (e.g. auth pages). */
export function useShell(): ShellState | null {
  return useContext(ShellContext)
}
