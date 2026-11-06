// PLACEHOLDER — W-core replaces this file with the real Add / Edit sheet.
import { useAddSheet } from '@/app/add-sheet'
import { ResponsiveSheet } from '@/components/ui/ResponsiveSheet'

/** Rendered once by AppShell; reads the global add-sheet state. */
export function AddSheetHost() {
  const { state, close } = useAddSheet()
  const income = state.options.kind === 'income'
  const editing = Boolean(state.options.transactionId)
  return (
    <ResponsiveSheet
      open={state.isOpen}
      onOpenChange={(open) => !open && close()}
      title={editing ? 'Edit Transaction' : income ? 'New Income' : 'New Expense'}
      confirmLabel={editing ? 'Save Changes' : income ? 'Add Income' : 'Add Expense'}
      confirmVerb={editing ? 'save' : 'add'}
      onConfirm={close}
      confirmDisabled
    >
      <p className="m-0 py-10 text-center text-subhead text-label-2">The Add sheet is coming next.</p>
    </ResponsiveSheet>
  )
}
