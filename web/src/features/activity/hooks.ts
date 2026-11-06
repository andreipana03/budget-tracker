import { useEffect, useRef, useState } from 'react'

import { useShell } from '@/app/shell-context'

/** `value`, updated only after it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/**
 * Calls `onVisible` when the returned element scrolls within ~600px of the app
 * scroller's bottom (infinite lists). Re-arms whenever `enabled` flips back on.
 */
export function useLoadMore(onVisible: () => void, enabled: boolean) {
  const shell = useShell()
  const ref = useRef<HTMLDivElement>(null)
  const callback = useRef(onVisible)
  useEffect(() => {
    callback.current = onVisible
  })
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current()
      },
      { root: shell?.scrollerRef.current ?? null, rootMargin: '0px 0px 600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, shell])
  return ref
}
