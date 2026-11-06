import { useMemo, useState } from 'react'

import {
  CategoryTile,
  InlineError,
  List,
  ResponsiveSheet,
  rowClasses,
  SectionFooter,
  SectionHeader,
  Segmented,
  useToast,
} from '@/components/ui'
import type { Category } from '@/lib/api/queries'
import { ApiError } from '@/lib/api/queries'
import { currencySymbol, formatMoney, formatMonthName, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { currentLimits, diffBudgets, initialDrafts, type BudgetMonth, type BudgetScope } from './budget-edit'
import { useSetBudgets } from './useBudgets'

export interface EditBudgetsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: BudgetMonth
  /** Expense categories (archived ones are filtered out here). */
  categories: Category[]
}

/**
 * Edit Budgets (also opened by `/budgets?edit=1`): every active expense category
 * with its limit, a live total and the scope ("From November On" / "Only November").
 * Saves only the changed categories in one PUT /budgets.
 * Mount it with a fresh `key` on every open so the fields start from the current limits.
 */
export function EditBudgetsSheet({ open, onOpenChange, data, categories }: EditBudgetsSheetProps) {
  const region = useRegion()
  const toast = useToast()
  const save = useSetBudgets()
  const currency = data.homeCurrency
  const month = data.period.month
  const monthName = formatMonthName(month)

  const cats = useMemo(
    () => categories.filter((c) => c.kind === 'expense' && !c.archived).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )
  const limits = useMemo(() => {
    const known = currentLimits(data)
    return Object.fromEntries(cats.map((c) => [c.id, known[c.id] ?? null]))
  }, [cats, data])

  const [drafts, setDrafts] = useState(() => initialDrafts(limits, currency, region))
  const [scope, setScope] = useState<BudgetScope>('ongoing')
  const diff = diffBudgets(
    limits,
    drafts,
    currency,
    cats.map((c) => c.id),
  )
  const hasErrors = Object.keys(diff.errors).length > 0
  const symbol = currencySymbol(currency, { region })

  const onConfirm = () => {
    if (hasErrors || diff.items.length === 0) return
    save.mutate(
      { month, scope, items: diff.items },
      {
        onSuccess: () => {
          toast.show({ title: 'Budgets saved' })
          onOpenChange(false)
        },
      },
    )
  }

  const apiError = save.error instanceof ApiError ? save.error : null
  const groups = [
    { title: 'Flexible', items: cats.filter((c) => !c.isFixed) },
    { title: 'Fixed', items: cats.filter((c) => c.isFixed) },
  ].filter((g) => g.items.length > 0)

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Budgets"
      confirmLabel="Save Budgets"
      onConfirm={onConfirm}
      confirmDisabled={diff.items.length === 0 || hasErrors || save.isPending}
      isDirty={diff.items.length > 0}
      discardTitle="Discard budget changes?"
    >
      <div className="flex flex-col gap-5 pb-2">
        <div>
          <Segmented
            aria-label="Apply to"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'ongoing', label: `From ${monthName} On` },
              { value: 'single_month', label: `Only ${monthName}` },
            ]}
          />
          <p className="m-0 px-4 pt-2 text-footnote text-label-2 lg:px-1">
            {scope === 'ongoing'
              ? `New limits apply from ${monthName} on, until you change them.`
              : `New limits apply to ${monthName} only. Other months keep theirs.`}
          </p>
        </div>

        {apiError && <InlineError message={apiError.message} />}

        <List>
          <div className={cn(rowClasses({ hasLeading: false }))}>
            <span className="flex-1 text-body">Monthly Total</span>
            <span className="text-body font-semibold tabular-nums" aria-live="polite">
              {formatMoney(diff.totalMinor, currency, { region })}
            </span>
          </div>
        </List>

        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`edit-budgets-${g.title}`}>
            <SectionHeader
              title={g.title}
              id={`edit-budgets-${g.title}`}
              as="h3"
              className="lg:pb-2 [&_h3]:lg:text-headline"
            />
            <List>
              {g.items.map((c) => {
                // Prefilled values always parse, so an error only shows once the person typed something invalid.
                const error = diff.errors[c.id]
                const inputId = `budget-${c.id}`
                const errorId = `${inputId}-error`
                return (
                  <div key={c.id} className={cn(rowClasses({}), 'flex-col items-stretch gap-1')}>
                    <span className="flex items-center gap-3">
                      <CategoryTile color={c.color} icon={c.icon} />
                      <label htmlFor={inputId} className="min-w-0 flex-1 truncate text-body">
                        {c.name}
                      </label>
                      <input
                        id={inputId}
                        inputMode="decimal"
                        enterKeyHint="done"
                        autoComplete="off"
                        placeholder="No limit"
                        value={drafts[c.id] ?? ''}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                        className={cn(
                          'w-24 min-w-0 border-0 bg-transparent text-right text-body text-label tabular-nums outline-none placeholder:text-placeholder',
                          error && 'text-negative',
                        )}
                      />
                      <span aria-hidden className="text-body text-label-2">
                        {symbol}
                      </span>
                    </span>
                    {error && (
                      <span id={errorId} className="pl-[42px] text-footnote text-negative lg:pl-10">
                        {error}
                      </span>
                    )}
                  </div>
                )
              })}
            </List>
          </section>
        ))}
        <SectionFooter className="-mt-3">
          {/* PUT /budgets: null removes the ongoing limit, but for single_month it removes the override. */}
          {scope === 'ongoing'
            ? `Leave a field empty for no limit. Amounts are in ${symbol}.`
            : `Leave a field empty to use the usual limit. Enter 0 for no spending in ${monthName}.`}
        </SectionFooter>
      </div>
    </ResponsiveSheet>
  )
}
