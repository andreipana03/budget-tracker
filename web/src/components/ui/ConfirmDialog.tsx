import { AlertDialog } from '@base-ui/react/alert-dialog'
import { useRef } from 'react'

import { cn } from '@/lib/utils'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A question in sentence case: "Delete “Groceries” and its 42 transactions?" */
  title: string
  /** One sentence explaining what can't be undone. */
  message?: string
  /** Verb, title case: "Delete Category". Never "OK" / "Yes". */
  confirmLabel: string
  cancelLabel?: string
  /** Red confirm label for irreversible destructive actions. */
  destructive?: boolean
  onConfirm: () => void
}

/**
 * Alert for irreversible actions only (design § 6.16, § 13) — routine deletes
 * use Undo instead. Cancel is the default (focused) button; Esc cancels.
 *
 *   <ConfirmDialog open={open} onOpenChange={setOpen} title="Delete your account?"
 *     message="All budgets and transactions will be deleted. This can't be undone."
 *     confirmLabel="Delete Account" destructive onConfirm={deleteAccount} />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const btn =
    'h-11 w-full rounded-[12px] lg:w-auto lg:flex-1 bg-fill-2 px-3 text-body transition-[background-color] duration-(--dur-press) hover:bg-fill-1 active:bg-fill-1 lg:h-8 lg:rounded-[8px]'
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="ui-sheet-backdrop z-70" />
        <AlertDialog.Popup
          initialFocus={cancelRef}
          className={cn(
            'glass glass-strong fixed top-1/2 left-1/2 z-71 w-[300px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 rounded-[22px] p-5 text-center text-label outline-none lg:w-[320px] lg:rounded-md',
            'transition-[scale,opacity] duration-(--dur-fast) ease-out data-starting-style:scale-105 data-starting-style:opacity-0 data-ending-style:opacity-0',
          )}
        >
          <AlertDialog.Title className="m-0 text-headline">{title}</AlertDialog.Title>
          {message && <AlertDialog.Description className="m-0 mt-1 text-footnote text-label-2">{message}</AlertDialog.Description>}
          <div className="mt-4 flex flex-col-reverse gap-2 lg:flex-row">
            <AlertDialog.Close ref={cancelRef} className={cn(btn, 'font-semibold')}>
              {cancelLabel}
            </AlertDialog.Close>
            <button
              type="button"
              className={cn(btn, destructive ? 'text-negative' : 'text-tint-text')}
              onClick={() => onConfirm()}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
