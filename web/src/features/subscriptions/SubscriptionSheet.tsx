import { useMemo, useRef, useState } from 'react'

import {
  Button,
  ConfirmDialog,
  DetailRow,
  InlineError,
  List,
  ResponsiveSheet,
  SectionFooter,
  Segmented,
  SelectRow,
  SwitchRow,
  TextFieldRow,
  useToast,
} from '@/components/ui'
import { ApiError, useAccounts, useCategories, useCurrencies, type Subscription } from '@/lib/api/queries'
import { formatDue, formatShortDate, parseAmount, toAmountInput, useRegion } from '@/lib/format'

import { intervalLabel, maxInterval, repeatText, type Frequency } from './subscription-text'
import { useSubscriptionMutations } from './useSubscriptionMutations'

type Kind = 'expense' | 'income'

interface FormState {
  kind: Kind
  title: string
  amount: string
  currency: string
  accountId: string
  categoryId: string
  frequency: Frequency
  intervalCount: number
  startsOn: string
  hasEnd: boolean
  endsOn: string
  isActive: boolean
}

export interface SubscriptionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this subscription; omit to add a new one. */
  subscription?: Subscription
  /** The household's today (default first payment, date copy). */
  today: string
}

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

/**
 * Add or edit a subscription (ResponsiveSheet). Edit mode adds the Paused switch
 * and "Delete Subscription" (confirmed: there's no undo; past payments stay).
 * Mount with a fresh `key` on every open.
 */
export function SubscriptionSheet({ open, onOpenChange, subscription: sub, today }: SubscriptionSheetProps) {
  const region = useRegion()
  const toast = useToast()
  const { create, update, remove } = useSubscriptionMutations()
  const accounts = useAccounts()
  const categories = useCategories()
  const currencies = useCurrencies()
  const nameRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const activeAccounts = useMemo(() => (accounts.data?.items ?? []).filter((a) => !a.archived), [accounts.data])
  const allCategories = useMemo(() => categories.data ?? [], [categories.data])

  const initial = useMemo<FormState>(() => {
    if (sub)
      return {
        kind: sub.kind,
        title: sub.title,
        amount: toAmountInput(sub.amountMinor, sub.currency, { region }),
        currency: sub.currency,
        accountId: sub.account.id,
        categoryId: sub.category.id,
        frequency: sub.frequency,
        intervalCount: sub.intervalCount,
        startsOn: sub.startsOn,
        hasEnd: sub.endsOn != null,
        endsOn: sub.endsOn ?? '',
        isActive: sub.isActive,
      }
    return {
      kind: 'expense',
      title: '',
      amount: '',
      currency: '',
      accountId: '',
      categoryId: '',
      frequency: 'monthly',
      intervalCount: 1,
      startsOn: today,
      hasEnd: false,
      endsOn: '',
      isActive: true,
    }
  }, [sub, region, today])

  const [form, setForm] = useState<FormState>(initial)
  const [showErrors, setShowErrors] = useState(false)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  // Defaults that depend on loaded lists (new subscription): first account/category of the kind.
  const kindCategories = allCategories.filter((c) => c.kind === form.kind && (!c.archived || c.id === form.categoryId))
  const accountId = form.accountId || activeAccounts[0]?.id || ''
  const account = (accounts.data?.items ?? []).find((a) => a.id === accountId)
  const categoryId = form.categoryId || kindCategories[0]?.id || ''
  const currency = form.currency || account?.currency || accounts.data?.homeCurrency || 'RON'

  const amountMinor = parseAmount(form.amount, currency)
  const errors: Record<string, string> = {}
  if (!form.title.trim()) errors.title = 'Enter a name.'
  if (form.amount.trim() === '') errors.amountMinor = 'Enter an amount.'
  else if (amountMinor == null || amountMinor <= 0) errors.amountMinor = 'Enter an amount like 39,99.'
  if (!categoryId) errors.categoryId = 'Choose a category.'
  if (!accountId) errors.accountId = 'Choose an account.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startsOn)) errors.startsOn = 'Choose the first payment date.'
  if (form.hasEnd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.endsOn)) errors.endsOn = 'Choose when it ends.'
    else if (form.endsOn < form.startsOn) errors.endsOn = 'The end date must be after the first payment.'
  }

  const mutation = sub ? update : create
  const apiError =
    mutation.error instanceof ApiError ? mutation.error : remove.error instanceof ApiError ? remove.error : null
  for (const f of apiError?.fields ?? []) if (!errors[f.field]) errors[f.field] = f.message
  const shown = (fields: string[]) =>
    fields.filter((f) => errors[f] && (showErrors || apiError?.fields.some((e) => e.field === f)))

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const busy = create.isPending || update.isPending || remove.isPending

  const onConfirm = () => {
    setShowErrors(true)
    const blocking = Object.keys(errors).filter((k) => !apiError?.fields.some((f) => f.field === k))
    if (blocking.length > 0 || amountMinor == null) return
    const common = {
      title: form.title.trim(),
      amountMinor,
      currency,
      accountId,
      categoryId,
      frequency: form.frequency,
      intervalCount: form.intervalCount,
      startsOn: form.startsOn,
    }
    if (sub) {
      update.mutate(
        {
          id: sub.id,
          body: {
            ...common,
            note: sub.note ?? undefined,
            endsOn: form.hasEnd ? form.endsOn : null,
            isActive: form.isActive,
            rowVersion: sub.rowVersion,
          },
        },
        {
          onSuccess: () => {
            const title =
              form.isActive !== sub.isActive
                ? form.isActive
                  ? 'Subscription resumed'
                  : 'Subscription paused'
                : 'Subscription saved'
            toast.show({ title })
            onOpenChange(false)
          },
        },
      )
    } else {
      create.mutate(
        { ...common, id: crypto.randomUUID(), kind: form.kind, ...(form.hasEnd ? { endsOn: form.endsOn } : {}) },
        {
          onSuccess: () => {
            toast.show({ title: 'Subscription added' })
            onOpenChange(false)
          },
        },
      )
    }
  }

  const onDelete = () => {
    if (!sub) return
    remove.mutate(sub.id, {
      onSuccess: () => {
        setConfirmDelete(false)
        toast.show({ title: 'Subscription deleted' })
        onOpenChange(false)
      },
      onError: () => setConfirmDelete(false),
    })
  }

  const currencyCodes = Array.from(
    new Set(
      [account?.currency, accounts.data?.homeCurrency, ...(currencies.data ?? []).map((c) => c.code), currency].filter(
        Boolean,
      ),
    ),
  ) as string[]

  const footer = (fields: string[], fallback?: string) => {
    const msgs = shown(fields).map((f) => errors[f])
    if (msgs.length) return <SectionFooter className="text-negative">{msgs.join(' ')}</SectionFooter>
    return fallback ? <SectionFooter>{fallback}</SectionFooter> : null
  }

  const title = sub ? sub.title || 'Subscription' : form.kind === 'income' ? 'New Repeating Income' : 'New Subscription'

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        confirmLabel={sub ? 'Save Changes' : 'Add Subscription'}
        confirmVerb={sub ? 'save' : 'add'}
        onConfirm={onConfirm}
        confirmDisabled={busy || (sub != null && !dirty)}
        isDirty={dirty}
        discardTitle={sub ? 'Discard your changes?' : 'Discard this subscription?'}
        initialFocus={sub ? undefined : nameRef}
      >
        <div className="flex flex-col gap-5 pb-2">
          {apiError && apiError.fields.length === 0 && (
            <InlineError
              message={
                apiError.code === 'version_conflict'
                  ? 'This subscription changed on another device. Close the sheet and open it again to see the latest.'
                  : apiError.message
              }
            />
          )}

          {!sub && (
            <Segmented
              aria-label="Type"
              value={form.kind}
              onChange={(k) => setForm((f) => ({ ...f, kind: k, categoryId: '' }))}
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
              ]}
            />
          )}

          <div>
            <List>
              <TextFieldRow
                ref={nameRef}
                label="Name"
                placeholder={form.kind === 'income' ? 'Allowance' : 'Netflix'}
                maxLength={80}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                aria-invalid={shown(['title']).length > 0 || undefined}
              />
              <TextFieldRow
                label="Amount"
                inputMode="decimal"
                placeholder="0,00"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                aria-invalid={shown(['amountMinor']).length > 0 || undefined}
                inputClassName="tabular-nums"
              />
              <SelectRow
                label="Currency"
                value={currency}
                onValueChange={(v) => set('currency', v)}
                options={currencyCodes.map((c) => ({ value: c, label: c }))}
              />
            </List>
            {footer(['title', 'amountMinor', 'currency'])}
          </div>

          <div>
            <List>
              <SelectRow
                label="Category"
                value={categoryId}
                onValueChange={(v) => set('categoryId', v)}
                options={kindCategories.map((c) => ({ value: c.id, label: c.name }))}
              />
              <SelectRow
                label="Account"
                value={accountId}
                onValueChange={(v) => {
                  const a = activeAccounts.find((x) => x.id === v)
                  setForm((f) => ({ ...f, accountId: v, currency: a?.currency ?? f.currency }))
                }}
                options={activeAccounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </List>
            {footer(['categoryId', 'accountId'])}
          </div>

          <div>
            <List>
              <SelectRow
                label="Repeats"
                value={form.frequency}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, frequency: v, intervalCount: Math.min(f.intervalCount, maxInterval(v)) }))
                }
                options={FREQUENCIES}
              />
              <SelectRow
                label="Every"
                value={String(form.intervalCount)}
                onValueChange={(v) => set('intervalCount', Number(v))}
                options={Array.from({ length: maxInterval(form.frequency) }, (_, i) => ({
                  value: String(i + 1),
                  label: intervalLabel(form.frequency, i + 1),
                }))}
              />
              <TextFieldRow
                label="First Payment"
                type="date"
                inputClassName="[&::-webkit-date-and-time-value]:text-right"
                value={form.startsOn}
                onChange={(e) => set('startsOn', e.target.value)}
                aria-invalid={shown(['startsOn']).length > 0 || undefined}
              />
              <SwitchRow
                label="Ends"
                checked={form.hasEnd}
                onCheckedChange={(v) => setForm((f) => ({ ...f, hasEnd: v, endsOn: v ? f.endsOn || f.startsOn : '' }))}
              />
              {form.hasEnd && (
                <TextFieldRow
                  label="Ends On"
                  type="date"
                  inputClassName="[&::-webkit-date-and-time-value]:text-right"
                  min={form.startsOn}
                  value={form.endsOn}
                  onChange={(e) => set('endsOn', e.target.value)}
                  aria-invalid={shown(['endsOn']).length > 0 || undefined}
                />
              )}
            </List>
            {footer(
              ['frequency', 'intervalCount', 'startsOn', 'endsOn'],
              `${repeatText(form.frequency, form.intervalCount)}, starting ${formatShortDate(form.startsOn || today, today)}.`,
            )}
          </div>

          {sub && (
            <div>
              <List>
                <DetailRow
                  label="Next Payment"
                  value={sub.isActive ? formatDue(sub.nextDueOn, today) : 'Paused'}
                  accessory="none"
                />
                <SwitchRow
                  label="Paused"
                  description="No new charges while paused."
                  checked={!form.isActive}
                  onCheckedChange={(paused) => set('isActive', !paused)}
                />
              </List>
              <SectionFooter>Changes apply to future payments. Past payments stay as they are.</SectionFooter>
            </div>
          )}

          {sub && (
            <List>
              <Button
                variant="destructive-plain"
                block
                className="h-11 rounded-none lg:h-9 lg:rounded-none"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete Subscription
              </Button>
            </List>
          )}
        </div>
      </ResponsiveSheet>
      {sub && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete “${sub.title}”?`}
          message="Future payments stop. Past payments stay in Activity. This can’t be undone."
          confirmLabel="Delete Subscription"
          destructive
          onConfirm={onDelete}
        />
      )}
    </>
  )
}
