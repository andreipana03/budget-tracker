import { useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { Icon, type IconName } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

const ACTION_W = 84 // px revealed per action
const OPEN_AT = 44 // px dragged to snap open
const FULL_SWIPE = 0.55 // share of the row width that triggers the action directly

interface SwipeAction {
  label: string
  icon: IconName
  onAction: () => void
}

/**
 * Compact swipe actions (design § 6.5): drag the row left for the trailing action
 * (Delete, red), right for the leading one (Edit). A short drag snaps the button open;
 * a long one runs the action. Touch only — the detail screen has the same actions, so
 * the gesture is never the only way. Keeps the list's hairline separators (it is the
 * `.ui-row` sibling now) and lets vertical scrolling through untouched.
 */
export function SwipeRow({
  children,
  leading,
  trailing,
  className,
}: {
  children: ReactNode
  leading?: SwipeAction
  trailing?: SwipeAction
  className?: string
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; base: number; mode: 'pending' | 'drag' | 'scroll'; id: number } | null>(null)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState(0) // resting offset: 0, ACTION_W (leading open) or -ACTION_W
  // Actions stay unrendered at rest so they can't bleed through the list's rounded corners.
  const [revealed, setRevealed] = useState(false)

  const apply = (px: number, animate: boolean) => {
    const el = contentRef.current
    if (!el) return
    el.style.transition = animate ? 'transform var(--dur-fast) var(--motion-ease-out)' : 'none'
    el.style.transform = px ? `translateX(${px}px)` : ''
  }

  const settle = (px: number) => {
    setOffset(px)
    apply(px, true)
    if (px === 0) window.setTimeout(() => setRevealed(false), 220)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    drag.current = { x: e.clientX, y: e.clientY, base: offset, mode: 'pending', id: e.pointerId }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || d.mode === 'scroll') return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.mode === 'pending') {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        d.mode = 'scroll'
        return
      }
      if (Math.abs(dx) < 8) return
      d.mode = 'drag'
      setRevealed(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    let px = d.base + dx
    if (!leading) px = Math.min(px, 0)
    if (!trailing) px = Math.max(px, 0)
    apply(px, false)
  }

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId || d.mode !== 'drag') return
    suppressClick.current = true
    const width = e.currentTarget.getBoundingClientRect().width || 375
    const px = d.base + (e.clientX - d.x)
    if (trailing && px < -width * FULL_SWIPE) {
      settle(0)
      trailing.onAction()
    } else if (leading && px > width * FULL_SWIPE) {
      settle(0)
      leading.onAction()
    } else if (trailing && px < -OPEN_AT) settle(-ACTION_W)
    else if (leading && px > OPEN_AT) settle(ACTION_W)
    else settle(0)
  }

  return (
    <div
      className={cn('ui-row ui-row--lg relative overflow-hidden before:z-[1] lg:overflow-visible', className)}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(e) => {
        // A drag, or a tap while open, shouldn't also open the row.
        if (suppressClick.current || offset !== 0) {
          if (!(e.target as HTMLElement).closest('[data-swipe-action]')) {
            e.preventDefault()
            e.stopPropagation()
            if (!suppressClick.current) settle(0)
          }
        }
        suppressClick.current = false
      }}
    >
      {leading && revealed && (
        <button
          type="button"
          data-swipe-action
          tabIndex={-1}
          aria-hidden={offset <= 0}
          onClick={() => {
            settle(0)
            leading.onAction()
          }}
          className="absolute inset-y-0 left-0 flex w-[84px] flex-col items-center justify-center gap-1 bg-tint text-footnote font-semibold text-on-tint"
        >
          <Icon name={leading.icon} weight="fill" className="text-[20px]" />
          {leading.label}
        </button>
      )}
      {trailing && revealed && (
        <button
          type="button"
          data-swipe-action
          tabIndex={-1}
          aria-hidden={offset >= 0}
          onClick={() => {
            settle(0)
            trailing.onAction()
          }}
          className="absolute inset-y-0 right-0 flex w-[84px] flex-col items-center justify-center gap-1 bg-negative-fill text-footnote font-semibold text-white"
        >
          <Icon name={trailing.icon} weight="fill" className="text-[20px]" />
          {trailing.label}
        </button>
      )}
      <div ref={contentRef} className="relative bg-surface will-change-transform">
        {children}
      </div>
    </div>
  )
}
