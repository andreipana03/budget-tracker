import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

import { useAddSheet } from './add-sheet'
import { TABS, tabIndexForPath } from './nav'
import { SHORTCUTS } from './shortcuts'

const PAD = 4 // nav padding (p-1)
const DRAG_SLOP = 6

/**
 * Compact/medium navigation (design § 6.1, § 11 snippet): a floating glass tab
 * bar with 4 tabs and a separate 62px glass-prominent Add button. Hidden ≥ 1024.
 * Tab labels and glyphs are fixed px on purpose (they don't grow with Dynamic Type).
 *
 * The selected pill slides between tabs. Press anywhere on the bar and slide: the pill
 * follows the finger (a little larger, like the system tab bar) and the tab under it opens
 * when the finger lifts. It also tracks a page swipe in progress (`--swipe-progress`).
 */
export function TabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const addSheet = useAddSheet()
  const current = tabIndexForPath(pathname)

  const navRef = useRef<HTMLElement>(null)
  const drag = useRef<{ id: number; x0: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [dragPos, setDragPos] = useState<number | null>(null)
  // Tapped tab, shown selected straight away while its screen loads (until the route changes).
  const [pending, setPending] = useState<{ index: number; from: string } | null>(null)
  const chosen = pending && pending.from === pathname ? pending.index : current

  const pillPos = dragPos ?? chosen
  const highlighted = dragPos != null ? Math.round(dragPos) : chosen

  const go = (i: number, fromDrag = false) => {
    const tab = TABS[i]
    if (!tab || (fromDrag && i === chosen)) return
    if (tab.path !== pathname) setPending({ index: i, from: pathname })
    navigate(tab.path)
  }

  const posAt = (clientX: number) => {
    const r = navRef.current!.getBoundingClientRect()
    const tabW = (r.width - PAD * 2) / TABS.length
    return Math.min(TABS.length - 1, Math.max(0, (clientX - r.left - PAD) / tabW - 0.5))
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return
    drag.current = { id: e.pointerId, x0: e.clientX, moved: false }
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x0) < DRAG_SLOP) return
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setDragPos(posAt(e.clientX))
  }

  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.moved) return // a tap: the tab's own click handles it
    suppressClick.current = true
    window.setTimeout(() => (suppressClick.current = false), 0)
    setDragPos(null)
    if (e.type === 'pointerup') go(Math.round(posAt(e.clientX)), true)
  }

  return (
    <div
      className="app-chrome app-tabbar fixed inset-x-4 z-30 flex items-center gap-2.5 md:right-auto md:left-1/2 md:w-[520px] md:-translate-x-1/2 lg:hidden"
      style={{ bottom: 'max(12px, calc(var(--safe-bottom) - 12px))' }}
    >
      <nav
        ref={navRef}
        role="tablist"
        aria-label="Sections"
        className="glass relative flex h-[62px] flex-1 touch-none rounded-full p-1 select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (!suppressClick.current) return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {pillPos >= 0 && (
          <span
            aria-hidden
            data-dragging={dragPos != null || undefined}
            className="tab-pill pointer-events-none absolute inset-y-1 left-1 rounded-full bg-glass-selected"
            style={{ width: `calc((100% - ${PAD * 2}px) / ${TABS.length})`, '--tab-pos': pillPos } as CSSProperties}
          />
        )}
        {TABS.map((t, i) => {
          const selected = i === chosen
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => go(i)}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-px rounded-full text-[11px] leading-[13px] font-semibold tracking-[0.01em] text-label',
                'transition-colors duration-(--dur-fast)',
                i === highlighted && 'text-tint',
              )}
            >
              <Icon name={t.icon} variant="tab" />
              {t.label}
            </button>
          )
        })}
      </nav>
      <button
        type="button"
        aria-label="Add Expense"
        aria-keyshortcuts={SHORTCUTS.add.keys}
        onClick={() => addSheet.open()}
        className="glass glass-prominent grid size-[62px] flex-none place-items-center rounded-full text-[28px] transition-transform duration-(--dur-press) ease-out active:scale-94"
      >
        <Icon name="plus" />
      </button>
    </div>
  )
}
