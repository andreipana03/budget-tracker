import { Toast } from '@base-ui/react/toast'
import { useCallback, useMemo } from 'react'

export interface ToastOptions {
  /** Past tense, matching the action's name: "Expense added", "Transaction deleted". */
  title: string
  /** Optional action, e.g. { label: 'Undo', onClick: restore }. */
  action?: { label: string; onClick: () => void }
  /** ms; default 5000. 0 keeps it until dismissed. */
  timeout?: number
}

/**
 * Show a toast:
 *
 *   const toast = useToast()
 *   toast.show({ title: 'Transaction deleted', action: { label: 'Undo', onClick: restore } })
 */
export function useToast() {
  const manager = Toast.useToastManager()
  const show = useCallback(
    ({ title, action, timeout }: ToastOptions) => {
      let id = ''
      id = manager.add({
        title,
        timeout,
        actionProps: action
          ? {
              children: action.label,
              onClick: () => {
                action.onClick()
                manager.close(id)
              },
            }
          : undefined,
      })
      return id
    },
    [manager],
  )
  return useMemo(() => ({ show, close: manager.close }), [show, manager.close])
}
