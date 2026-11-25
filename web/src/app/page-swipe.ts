import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'

import { isCompactViewport, pageTransitionRunning } from './page-transitions'

const EDGE = 24 // px at the screen edges left to Safari's own Back / Forward swipe
const SLOP = 10 // px before a touch counts as a horizontal drag
const COMMIT_SHARE = 0.4 // share of the width that switches page on release
const FLICK = 0.35 // px/ms: a quicker flick switches page from any distance > 24px
const RUBBER = 0.3 // resistance past the first / last tab
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)' // --motion-ease-sheet
const IGNORE = 'input, textarea, select, [contenteditable="true"], [role="slider"], [data-swipe-row], [data-no-page-swipe]'

/** Switch page on release? `x` = how far the page moved (px), `v` = finger velocity (px/ms, + = right). */
export function shouldCommitSwipe(x: number, v: number, width: number): boolean {
  if (Math.abs(x) > width * COMMIT_SHARE) return true
  return Math.abs(v) > FLICK && Math.sign(v) === Math.sign(x) && Math.abs(x) > 24
}

/** Settle duration (ms) for the distance left, continuing the finger's speed. */
export function settleDuration(remaining: number, v: number, width: number): number {
  const speed = Math.max(Math.abs(v), width / 300)
  return Math.round(Math.min(320, Math.max(140, Math.abs(remaining) / speed)))
}

interface SwipeState {
  g: Gesture | null
  peek: HTMLElement | null
  /** How far the page has moved, px. */
  x: number
  /** 1 = the next tab slides in from the right, -1 = the previous one from the left, 0 = none. */
  dir: -1 | 0 | 1
  settling: boolean
  /** Waiting for the route change after a completed swipe. */
  committed: boolean
  timer: number
}

interface Gesture {
  id: number
  x0: number
  y0: number
  mode: 'pending' | 'drag'
  samples: { x: number; t: number }[]
}

export interface PageSwipeOptions {
  /** The element that moves (`.app-main`); listeners go on it. */
  pageRef: RefObject<HTMLElement | null>
  /** Gets `--swipe-progress` (−1…1, the tab pill follows it) and `data-swiping`. */
  shellRef: RefObject<HTMLElement | null>
  /** TABS index of the current screen when it is a tab root, else -1 (no swiping). */
  index: number
  count: number
  /** E.g. a sheet is open. */
  disabled: boolean
  /** Render the neighbour tab `i` (or nothing) in the peek layer. */
  onPeek: (i: number | null) => void
  /** The page finished sliding to tab `i`: navigate there (without a View Transition). */
  onCommit: (i: number) => void
}

/**
 * Horizontal page swipe between the 4 tab screens on compact (design § 5.3). The page
 * follows the finger 1:1 with the neighbour sliding in beside it (rendered live by the
 * shell's peek layer); past the first / last tab it rubber-bands. Release past 40% of the
 * width, or flick, to switch. Rows with their own swipe actions, text fields and the
 * screen edges (Safari's Back gesture) are left alone.
 *
 * Returns `attachPeek` for the peek element's ref and `settle`, which the shell calls when
 * the route changes: true = this navigation came from a swipe and the layers were reset.
 */
export function usePageSwipe(options: PageSwipeOptions) {
  const live = useRef(options)
  useLayoutEffect(() => {
    live.current = options
  })

  // Mutable gesture state, shared by the listeners (never rendered).
  const state = useRef<SwipeState>({ g: null, peek: null, x: 0, dir: 0, settling: false, committed: false, timer: 0 })

  const layout = useCallback(
    (x: number, ms = 0) => {
      const s = state.current
      const page = live.current.pageRef.current
      const shell = live.current.shellRef.current
      if (!page) return
      const w = page.clientWidth || window.innerWidth
      const transition = ms ? `transform ${ms}ms ${EASE}` : 'none'
      page.style.transition = transition
      page.style.transform = `translate3d(${x}px, 0, 0)`
      if (s.peek && s.dir) {
        s.peek.style.transition = transition
        s.peek.style.transform = `translate3d(${x + s.dir * w}px, 0, 0)`
      }
      shell?.style.setProperty('--swipe-progress', s.dir ? String(-x / w) : '0')
    },
    [],
  )

  const reset = useCallback(() => {
    const s = state.current
    window.clearTimeout(s.timer)
    const page = live.current.pageRef.current
    const shell = live.current.shellRef.current
    if (page) {
      // .app-main has a transform transition of its own (the sheet recede): skip it here.
      page.style.transition = 'none'
      page.style.transform = ''
      page.style.willChange = ''
      void page.offsetWidth
      page.style.transition = ''
    }
    shell?.style.removeProperty('--swipe-progress')
    shell?.removeAttribute('data-swiping')
    s.g = null
    s.x = 0
    s.dir = 0
    s.settling = false
    s.peek = null
    live.current.onPeek(null)
  }, [])

  useEffect(() => {
    const s = state.current
    const page = options.pageRef.current
    if (!page) return

    const onDown = (e: PointerEvent) => {
      if (s.g) {
        if (s.g.mode === 'pending') s.g = null // a second finger: probably a pinch
        return
      }
      const o = live.current
      if (e.pointerType === 'mouse' || !e.isPrimary || s.settling || o.disabled || o.index < 0) return
      if (!isCompactViewport() || pageTransitionRunning()) return
      if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return
      if (e.target instanceof Element && e.target.closest(IGNORE)) return
      s.g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: 'pending', samples: [] }
    }

    const onMove = (e: PointerEvent) => {
      const g = s.g
      if (!g || g.id !== e.pointerId) return
      const dx = e.clientX - g.x0
      const dy = e.clientY - g.y0
      if (g.mode === 'pending') {
        if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) {
          s.g = null // vertical: let the list scroll
          return
        }
        if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy) * 1.2) return
        g.mode = 'drag'
        g.x0 += Math.sign(dx) * SLOP // start from the finger, without a jump
        page.setPointerCapture(e.pointerId)
        page.style.willChange = 'transform'
        live.current.shellRef.current?.setAttribute('data-swiping', '')
      }
      const o = live.current
      const d = e.clientX - g.x0
      const want: -1 | 1 = d < 0 ? 1 : -1
      const target = o.index + want
      const has = d !== 0 && target >= 0 && target < o.count
      if (has && want !== s.dir) {
        s.dir = want
        s.peek = null // the new neighbour attaches itself when it mounts
        o.onPeek(target)
      } else if (!has && s.dir !== 0 && d !== 0) {
        s.dir = 0
        s.peek = null
        o.onPeek(null)
      }
      s.x = has ? d : d * RUBBER
      layout(s.x)
      g.samples.push({ x: e.clientX, t: e.timeStamp })
      while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift()
    }

    const onEnd = (e: PointerEvent) => {
      const g = s.g
      if (!g || g.id !== e.pointerId) return
      s.g = null
      if (g.mode !== 'drag') return
      live.current.shellRef.current?.removeAttribute('data-swiping') // the tab pill animates again
      const w = page.clientWidth || window.innerWidth
      const first = g.samples[0]
      const last = g.samples[g.samples.length - 1]
      const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0
      s.settling = true
      if (e.type === 'pointerup' && s.dir !== 0 && shouldCommitSwipe(s.x, v, w)) {
        const end = -s.dir * w
        const ms = settleDuration(end - s.x, v, w)
        const target = live.current.index + s.dir
        layout(end, ms)
        s.timer = window.setTimeout(() => {
          s.committed = true
          live.current.onCommit(target)
          // The route change calls settle(); if it never comes, put everything back.
          s.timer = window.setTimeout(() => {
            s.committed = false
            reset()
          }, 1500)
        }, ms)
      } else {
        const ms = settleDuration(s.x, v, w)
        layout(0, ms)
        s.timer = window.setTimeout(reset, ms)
      }
    }

    page.addEventListener('pointerdown', onDown)
    page.addEventListener('pointermove', onMove)
    page.addEventListener('pointerup', onEnd)
    page.addEventListener('pointercancel', onEnd)
    return () => {
      page.removeEventListener('pointerdown', onDown)
      page.removeEventListener('pointermove', onMove)
      page.removeEventListener('pointerup', onEnd)
      page.removeEventListener('pointercancel', onEnd)
      window.clearTimeout(s.timer)
    }
  }, [options.pageRef, layout, reset])

  /** Ref callback for the peek layer: position it beside the page as soon as it mounts. */
  const attachPeek = useCallback(
    (el: HTMLElement | null) => {
      const s = state.current
      if (!el) return
      s.peek = el
      layout(s.x)
      return () => {
        if (s.peek === el) s.peek = null
      }
    },
    [layout],
  )

  /** Call in a layout effect when the route changes. True when it was a swipe's navigation. */
  const settle = useCallback((): boolean => {
    const s = state.current
    if (!s.committed) return false
    s.committed = false
    reset()
    return true
  }, [reset])

  return useMemo(() => ({ attachPeek, settle }), [attachPeek, settle])
}
