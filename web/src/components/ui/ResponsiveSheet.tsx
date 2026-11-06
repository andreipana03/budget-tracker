import { Dialog } from '@base-ui/react/dialog'
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'

import { cn } from '@/lib/utils'

import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'
import { GlassButton } from './GlassButton'
import type { IconName } from './Icon'
import { useSheetPresence } from './sheet-presence'

const REGULAR = '(min-width: 1024px)'
const DISMISS_DISTANCE = 120 // px dragged down
const DISMISS_VELOCITY = 0.6 // px/ms flick

export interface ResponsiveSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Centered title: "New Expense". Labels the dialog. */
  title: string
  /** The primary action's name, title case: "Add Expense", "Save Changes". The compact ✓ uses it as aria-label. */
  confirmLabel?: string
  /** Primary action. Without it the sheet is informational: no ✓, desktop footer shows "Done". */
  onConfirm?: () => void
  /** Disable the primary action (e.g. until the amount is > 0). */
  confirmDisabled?: boolean
  /** Compact confirm glyph (default `check`). */
  confirmIcon?: IconName
  /** Desktop footer hint. Default: "⌘↩ to {confirmVerb} · Esc to cancel". */
  hint?: string
  /** Verb in the default hint: "add", "save". Default "save". */
  confirmVerb?: string
  /** True when closing would lose typed input: swipe/Esc/✕/backdrop then ask to discard first. */
  isDirty?: boolean
  /** Discard confirmation title, e.g. "Discard this expense?". */
  discardTitle?: string
  /** Element to focus on open (e.g. the amount input). Default: first focusable. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Extra leading content in the desktop footer (e.g. a destructive "Delete" button). */
  footerLeading?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * ONE component, two presentations (design § 6.11):
 *
 * - compact (< 1024): bottom sheet at the large detent (safe-top + 10px), grabber,
 *   drag/swipe down to dismiss, page behind recedes to scale(.92) on black; bar with a
 *   leading ✕ glass circle, centered title, trailing prominent ✓ glass circle.
 * - regular (≥ 1024): centered 520px dialog, fades/scales in 200ms, footer with the
 *   hint "⌘↩ to … · Esc to cancel" + Cancel + primary button.
 *
 * Base UI Dialog provides the focus trap, Esc, `aria-modal`, labelling and focus
 * restore. ⌘↩ / Ctrl+↩ confirms.
 *
 *   <ResponsiveSheet open={open} onOpenChange={setOpen} title="New Expense"
 *     confirmLabel="Add Expense" confirmVerb="add" onConfirm={save} confirmDisabled={!amount}
 *     isDirty={amount > 0} discardTitle="Discard this expense?" initialFocus={amountRef}>
 *     <Segmented … />  <List>…</List>
 *   </ResponsiveSheet>
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  confirmLabel = 'Done',
  onConfirm,
  confirmDisabled,
  confirmIcon = 'check',
  hint,
  confirmVerb = 'save',
  isDirty,
  discardTitle = 'Discard changes?',
  initialFocus,
  footerLeading,
  children,
  className,
}: ResponsiveSheetProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startY: number; dy: number; lastY: number; lastT: number; v: number; id: number } | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  useSheetPresence(open)

  const requestClose = () => {
    if (isDirty) setConfirmingDiscard(true)
    else onOpenChange(false)
  }

  const confirm = () => {
    if (!onConfirm || confirmDisabled) return
    onConfirm()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (onConfirm) confirm()
      else onOpenChange(false)
    }
  }

  /* ---- drag to dismiss (compact only), from the grabber/bar ---- */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia(REGULAR).matches) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY, dy: 0, lastY: e.clientY, lastT: e.timeStamp, v: 0, id: e.pointerId }
    popupRef.current?.setAttribute('data-dragging', '')
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !popupRef.current) return
    const raw = e.clientY - d.startY
    d.dy = raw >= 0 ? raw : raw / 4 // rubber-band upwards
    const dt = Math.max(e.timeStamp - d.lastT, 1)
    d.v = (e.clientY - d.lastY) / dt
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    popupRef.current.style.translate = `0 ${d.dy}px`
  }
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = popupRef.current
    if (!d || d.id !== e.pointerId || !el) return
    drag.current = null
    el.removeAttribute('data-dragging')
    const dismiss = d.dy > DISMISS_DISTANCE || (d.dy > 24 && d.v > DISMISS_VELOCITY)
    if (dismiss && !isDirty) {
      el.style.translate = '0 105%' // keep sliding from here instead of bouncing back first
      onOpenChange(false)
    } else {
      el.style.translate = ''
      if (dismiss) setConfirmingDiscard(true)
    }
  }

  const footerHint = hint ?? `⌘↩ to ${onConfirm ? confirmVerb : 'close'} · Esc to cancel`

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true)
          else requestClose()
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="ui-sheet-backdrop" />
          <Dialog.Popup
            ref={popupRef}
            initialFocus={initialFocus}
            onKeyDown={onKeyDown}
            className={cn('ui-sheet', className)}
          >
            <div
              className="flex-none touch-none select-none lg:touch-auto"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
            >
              <div aria-hidden className="mx-auto mt-1.5 h-[5px] w-9 rounded-[3px] bg-fill-1 lg:hidden" />
              <div className="relative flex items-center justify-between px-4 pt-2 pb-1.5 lg:justify-center lg:px-5 lg:pt-[18px] lg:pb-1">
                <GlassButton icon="x" label="Cancel" onClick={requestClose} className="lg:hidden" />
                <Dialog.Title className="pointer-events-none absolute inset-x-16 m-0 truncate text-center text-headline lg:static">
                  {title}
                </Dialog.Title>
                {onConfirm ? (
                  <GlassButton
                    icon={confirmIcon}
                    label={confirmLabel}
                    prominent
                    disabled={confirmDisabled}
                    onClick={confirm}
                    className="lg:hidden"
                  />
                ) : (
                  <span className="size-11 lg:hidden" />
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(var(--safe-bottom)+24px)] lg:px-5 lg:pb-3">
              {children}
            </div>
            <div className="hidden flex-none items-center justify-end gap-2.5 border-t-[0.5px] border-separator px-5 pt-3.5 pb-[18px] lg:flex">
              {footerLeading}
              <span className="mr-auto text-footnote text-label-2">{footerHint}</span>
              {onConfirm ? (
                <>
                  <Button variant="secondary" onClick={requestClose} className="lg:rounded-[8px] lg:px-4">
                    Cancel
                  </Button>
                  <Button
                    variant="prominent"
                    onClick={confirm}
                    disabled={confirmDisabled}
                    aria-keyshortcuts="Meta+Enter Control+Enter"
                    className="lg:rounded-[8px] lg:px-4"
                  >
                    {confirmLabel}
                  </Button>
                </>
              ) : (
                <Button variant="prominent" onClick={() => onOpenChange(false)} className="lg:rounded-[8px] lg:px-4">
                  Done
                </Button>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title={discardTitle}
        message="What you entered will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        destructive
        onConfirm={() => {
          setConfirmingDiscard(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}
