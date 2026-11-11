import { useState } from 'react'

/**
 * A number that increases every time `open` turns true. Use it as a sheet's `key`
 * so its form starts fresh on each open (React's "adjust state while rendering"
 * pattern — no effect needed).
 */
export function useOpenSession(open: boolean): number {
  const [state, setState] = useState({ open, session: open ? 1 : 0 })
  if (state.open !== open) {
    const next = { open, session: open ? state.session + 1 : state.session }
    setState(next)
    return next.session
  }
  return state.session
}
