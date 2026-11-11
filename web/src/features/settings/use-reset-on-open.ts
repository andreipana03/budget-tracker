import { useState } from 'react'

/**
 * Run `reset` (state setters of the calling component) when a sheet opens, during
 * render — React's "adjust state when a prop changes" pattern, no effect needed.
 */
export function useResetOnOpen(open: boolean, reset: () => void) {
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) reset()
  }
}
