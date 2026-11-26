/* oxlint-disable react/only-export-components -- provider + its hook belong together */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface TransferSheetOptions {
  /** Edit an existing transfer ("Save Changes") instead of adding one. */
  transferId?: string
  /** Preselect where the money leaves from / arrives in. */
  fromAccountId?: string
  toAccountId?: string
}

export interface TransferSheetState {
  isOpen: boolean
  options: TransferSheetOptions
  /** Increments on every open — use as a React `key` to reset the form. */
  session: number
}

export interface TransferSheetApi {
  open: (opts?: TransferSheetOptions) => void
  close: () => void
  state: TransferSheetState
}

const TransferSheetContext = createContext<TransferSheetApi | null>(null)

/**
 * Global Transfer sheet state, the Add sheet's sibling (same ResponsiveSheet, same
 * motion). Opened from Home › Accounts ("Transfer"), Settings › Accounts, the sidebar's
 * Accounts group, T on the keyboard, and a transfer's Edit. Rendered once by the shell
 * through `<TransferSheetHost />` (features/transfers).
 */
export function TransferSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TransferSheetState>({ isOpen: false, options: {}, session: 0 })
  const open = useCallback(
    (opts: TransferSheetOptions = {}) =>
      setState((s) => (s.isOpen ? s : { isOpen: true, options: opts, session: s.session + 1 })),
    [],
  )
  const close = useCallback(() => setState((s) => ({ ...s, isOpen: false })), [])
  const api = useMemo(() => ({ open, close, state }), [open, close, state])
  return <TransferSheetContext.Provider value={api}>{children}</TransferSheetContext.Provider>
}

/**
 *   const transferSheet = useTransferSheet()
 *   transferSheet.open()                              // new transfer
 *   transferSheet.open({ transferId: tr.id })         // edit
 */
export function useTransferSheet(): TransferSheetApi {
  const ctx = useContext(TransferSheetContext)
  if (!ctx) throw new Error('useTransferSheet must be used inside <TransferSheetProvider>')
  return ctx
}
