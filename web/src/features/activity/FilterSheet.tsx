import { Button } from '@/components/ui/Button'
import { SelectRow } from '@/components/ui/FormRows'
import { List } from '@/components/ui/List'
import { ResponsiveSheet } from '@/components/ui/ResponsiveSheet'
import type { Account, Category } from '@/lib/api/queries'

const ALL = 'all'

/**
 * Compact Activity › Filter (top-bar button): category and account. Changes apply as
 * they're picked; "Done" closes. Desktop shows the same two filters as pop-ups.
 */
export function FilterSheet({
  open,
  onOpenChange,
  categories,
  accounts,
  categoryId,
  accountId,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: readonly Category[]
  accounts: readonly Account[]
  categoryId: string | undefined
  accountId: string | undefined
  onChange: (next: { categoryId?: string; accountId?: string }) => void
}) {
  const active = Boolean(categoryId || accountId)
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Filter" confirmVerb="close">
      <List>
        <SelectRow
          label="Category"
          value={categoryId ?? ALL}
          options={[{ value: ALL, label: 'All Categories' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          onValueChange={(v) => onChange({ categoryId: v === ALL ? undefined : v, accountId })}
        />
        <SelectRow
          label="Account"
          value={accountId ?? ALL}
          options={[{ value: ALL, label: 'All Accounts' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          onValueChange={(v) => onChange({ categoryId, accountId: v === ALL ? undefined : v })}
        />
      </List>
      {active && (
        <Button variant="plain" className="mt-3 w-full" onClick={() => onChange({})}>
          Clear Filters
        </Button>
      )}
    </ResponsiveSheet>
  )
}
