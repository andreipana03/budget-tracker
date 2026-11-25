import type { ReactNode, RefObject } from 'react'

/**
 * One screen's frame: the scroller (padded for the floating bars) and the scroll-edge blur
 * bands. Used by the shell's page and by the swipe peek, so both line up exactly.
 * `touch-action: pan-y` lets horizontal drags reach the page swipe on compact.
 */
export function PageFrame({ scrollerRef, children }: { scrollerRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <>
      <main
        ref={scrollerRef}
        className="ui-scroller absolute inset-0 overflow-y-auto overscroll-contain pt-[calc(var(--safe-top)+46px)] pb-[calc(var(--safe-bottom)+var(--tabbar-h)+40px)] max-lg:touch-pan-y max-lg:touch-pinch-zoom lg:pt-0 lg:pb-12"
      >
        {children}
      </main>
      <div aria-hidden className="scroll-edge-top app-chrome absolute inset-x-0 top-0 z-15 h-[calc(var(--safe-top)+60px)] lg:h-[76px]" />
      <div
        aria-hidden
        className="scroll-edge-bottom app-chrome absolute inset-x-0 bottom-0 z-15 h-[calc(var(--safe-bottom)+var(--tabbar-h)+28px)] lg:hidden"
      />
    </>
  )
}
