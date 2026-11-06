import { createContext, useContext, useEffect } from 'react'

/**
 * Lets an open compact sheet tell the app shell to recede (scale .92, 36px
 * corners on black). The shell provides it; outside a shell it's a no-op.
 */
export const SheetPresenceContext = createContext<((delta: 1 | -1) => void) | null>(null)

export function useSheetPresence(open: boolean) {
  const report = useContext(SheetPresenceContext)
  useEffect(() => {
    if (!open || !report) return
    report(1)
    return () => report(-1)
  }, [open, report])
}
