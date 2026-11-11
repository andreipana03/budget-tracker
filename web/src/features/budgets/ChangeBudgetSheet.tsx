import { useRef, useState } from 'react'

import { InlineError, List, ResponsiveSheet, SectionFooter, SwitchRow, TextFieldRow, useToast } from '@/components/ui'
import { ApiError } from '@/lib/api/queries'
import { currencySymbol, formatMonthName, toAmountInput, useRegion } from '@/lib/format'

import { INVALID_AMOUNT, parseLimit, type BudgetLine } from './budget-edit'
import { useSetBudgets } from './useBudgets'

export interface ChangeBudgetSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  line: Pick<BudgetLine, 'category' | 'limitMinor' | 'scope'>
  /** Budget month, YYYY-MM. */
  month: string
  currency: string
}

/**
 * "Change Budget" for one category (category detail, "Set Budget" on Not Budgeted):
 * the monthly limit and an "Only {Month}" switch. Empty = no limit.
 * Mount with a fresh `key` on every open.
 */
export function ChangeBudgetSheet({ open, onOpenChange, line, month, currency }: ChangeBudgetSheetProps) {
  const region = useRegion()
  const toast = useToast()
  const save = useSetBudgets()
  const inputRef = useRef<HTMLInputElement>(null)
  const monthName = formatMonthName(month)
  const initial = line.limitMinor == null ? '' : toAmountInput(line.limitMinor, currency, { region })
  const [text, setText] = useState(initial)
  const [onlyThisMonth, setOnlyThisMonth] = useState(line.scope === 'single_month')

  const parsed = parseLimit(text, currency)
  const invalid = parsed === undefined
  const changed = !invalid && parsed !== line.limitMinor
  const scopeChanged = onlyThisMonth !== (line.scope === 'single_month') && line.limitMinor != null
  const symbol = currencySymbol(currency, { region })

  const onConfirm = () => {
    if (invalid || (!changed && !scopeChanged)) return
    save.mutate(
      {
        month,
        scope: onlyThisMonth ? 'single_month' : 'ongoing',
        items: [{ categoryId: line.category.id, amountMinor: parsed }],
      },
      {
        onSuccess: () => {
          toast.show({ title: 'Budget saved' })
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={line.limitMinor == null ? 'Set Budget' : 'Change Budget'}
      confirmLabel="Save Budget"
      onConfirm={onConfirm}
      confirmDisabled={invalid || (!changed && !scopeChanged) || save.isPending}
      isDirty={text !== initial}
      discardTitle="Discard this change?"
      initialFocus={inputRef}
    >
      <div className="flex flex-col gap-5 pb-2">
        {save.error instanceof ApiError && <InlineError message={save.error.message} />}
        <div>
          <List>
            <TextFieldRow
              ref={inputRef}
              label={`${line.category.name} (${symbol})`}
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="No limit"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={invalid || undefined}
              inputClassName="tabular-nums"
            />
            <SwitchRow
              label={`Only ${monthName}`}
              description={onlyThisMonth ? 'Other months keep their limit.' : `Applies from ${monthName} on.`}
              checked={onlyThisMonth}
              onCheckedChange={setOnlyThisMonth}
            />
          </List>
          <SectionFooter className={invalid ? 'text-negative' : undefined}>
            {invalid
              ? INVALID_AMOUNT
              : onlyThisMonth
                ? `Leave the amount empty to use the usual limit in ${monthName}.`
                : 'Leave the amount empty for no limit.'}
          </SectionFooter>
        </div>
      </div>
    </ResponsiveSheet>
  )
}
