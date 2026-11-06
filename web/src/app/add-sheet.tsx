/* oxlint-disable react/only-export-components -- provider + its hook belong together */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface AddSheetOptions {
  /** Start in Expense (default) or Income mode. */
  kind?: 'expense' | 'income'
  /** Edit an existing transaction ("Save Changes") instead of adding one. */
  transactionId?: string
  /** Preselect a category (e.g. from Category detail). */
  categoryId?: string
}

export interface AddSheetState {
  isOpen: boolean
  options: AddSheetOptions
  /** Increments on every open — use as a React `key` to reset the form. */
  session: number
}

export interface AddSheetApi {
  open: (opts?: AddSheetOptions) => void
  close: () => void
  state: AddSheetState
}

const AddSheetContext = createContext<AddSheetApi | null>(null)

/**
 * Global Add/Edit sheet state. Opened from the tab bar's + button, the toolbar's
 * "Add Transaction", ⌘N / N, empty states and transaction details. Rendered once
 * by the shell through `<AddSheetHost />` (features/add).
 */
export function AddSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AddSheetState>({ isOpen: false, options: {}, session: 0 })
  const open = useCallback(
    (opts: AddSheetOptions = {}) =>
      setState((s) => (s.isOpen ? s : { isOpen: true, options: opts, session: s.session + 1 })),
    [],
  )
  const close = useCallback(() => setState((s) => ({ ...s, isOpen: false })), [])
  const api = useMemo(() => ({ open, close, state }), [open, close, state])
  return <AddSheetContext.Provider value={api}>{children}</AddSheetContext.Provider>
}

/**
 *   const addSheet = useAddSheet()
 *   addSheet.open({ kind: 'income' })
 *   addSheet.open({ transactionId: tx.id })   // edit
 */
export function useAddSheet(): AddSheetApi {
  const ctx = useContext(AddSheetContext)
  if (!ctx) throw new Error('useAddSheet must be used inside <AddSheetProvider>')
  return ctx
}
