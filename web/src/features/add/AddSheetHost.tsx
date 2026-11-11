import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAddSheet, type AddSheetOptions } from '@/app/add-sheet'
import { SelectRow, TextFieldRow } from '@/components/ui/FormRows'
import { List, RowAccessory } from '@/components/ui/List'
import { ResponsiveSheet } from '@/components/ui/ResponsiveSheet'
import { rowClasses } from '@/components/ui/row-classes'
import { Segmented } from '@/components/ui/Segmented'
import { SkeletonBlock } from '@/components/ui/States'
import { useToast } from '@/components/ui/use-toast'
import { kindNoun, type EntryKind, type Transaction } from '@/features/activity/transactions'
import { useRecentOfKind, useTransaction } from '@/features/activity/useTransactions'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'
import {
  invalidateMoney,
  useAccounts,
  useCategories,
  useCurrencies,
  useHousehold,
  type Category,
} from '@/lib/api/queries'
import { decimalSeparator, formatDay, localeForRegion, toAmountInput, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { amountMinorFromInput, sanitizeAmountInput } from './amount-entry'
import { AmountEntry } from './AmountEntry'
import { CategoryGrid } from './CategoryGrid'
import { pickDefaults } from './defaults'
import { buildHint } from './hint'
import { useCurrentBudgets, useFxQuote } from './queries'
import { uuidv7 } from './uuidv7'

type Repeat = 'never' | 'weekly' | 'monthly' | 'yearly'

interface FormState {
  kind: EntryKind
  amountText: string
  currency: string
  categoryId: string | null
  accountId: string | null
  /** Becomes the title; blank → the API uses the category name. */
  note: string
  date: string
  repeat: Repeat
}

const KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
] as const

const REPEAT_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
] as const

/** Entry time for a transaction dated today (the desktop table shows it). */
const nowIso = () => new Date().toISOString()

function groupSeparator(region: string): string {
  return (
    new Intl.NumberFormat(localeForRegion(region)).formatToParts(10000).find((p) => p.type === 'group')?.value ?? '.'
  ).replace(/[  ]/g, ' ')
}

/**
 * The global Add / Edit sheet (design § 6.11), rendered once by the shell. Opened with
 * useAddSheet().open({ kind, transactionId, categoryId }) from the + button, the toolbar,
 * ⌘N / N, empty states and transaction details. Each open is a fresh form.
 */
export function AddSheetHost() {
  const { state, close } = useAddSheet()
  if (state.session === 0) return null
  return <AddSheet key={state.session} open={state.isOpen} options={state.options} onClose={close} />
}

function AddSheet({ open, options, onClose }: { open: boolean; options: AddSheetOptions; onClose: () => void }) {
  const region = useRegion()
  const queryClient = useQueryClient()
  const toast = useToast()
  const editingId = options.transactionId
  const editing = Boolean(editingId)

  const household = useHousehold()
  const categories = useCategories()
  const accounts = useAccounts()
  const currencies = useCurrencies()
  const recentExpense = useRecentOfKind('expense', !editing)
  const recentIncome = useRecentOfKind('income', !editing)
  const editTx = useTransaction(editingId)

  const amountRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [initial, setInitial] = useState<FormState | null>(null)
  const [id] = useState(() => uuidv7()) // one id per form: retries stay idempotent
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const decimalSep = decimalSeparator({ region })
  const groupSep = groupSeparator(region)
  const home = household.data?.homeCurrency ?? 'RON'
  const today = household.data?.today ?? ''
  const accountItems = useMemo(() => accounts.data?.items ?? [], [accounts.data])
  const recentFor = (kind: EntryKind) => (kind === 'income' ? recentIncome : recentExpense)

  const formFromTransaction = (t: Transaction): FormState => ({
    kind: t.kind,
    amountText: toAmountInput(t.amountMinor, t.currency, { region }),
    currency: t.currency,
    categoryId: t.category.id,
    accountId: t.account.id,
    note: t.title === t.category.name ? '' : t.title,
    date: t.occurredOn,
    repeat: 'never',
  })

  // Initialise once the data it depends on is here (adjusting state during render).
  if (!form) {
    if (editing) {
      if (editTx.data && household.data) {
        const f = formFromTransaction(editTx.data)
        setForm(f)
        setInitial(f)
      }
    } else if (categories.data && accounts.data && household.data) {
      const preset = options.categoryId ? categories.data.find((c) => c.id === options.categoryId) : undefined
      const kind: EntryKind = preset?.kind ?? options.kind ?? 'expense'
      const recent = recentFor(kind)
      if (!recent.isPending || recent.fetchStatus === 'idle') {
        const picks = pickDefaults({
          kind,
          categories: categories.data,
          accounts: accountItems,
          recent: recent.data?.items ?? [],
          presetCategoryId: options.categoryId,
        })
        const account = accountItems.find((a) => a.id === picks.accountId)
        const f: FormState = {
          kind,
          amountText: '',
          currency: account?.currency ?? household.data.homeCurrency,
          categoryId: picks.categoryId,
          accountId: picks.accountId,
          note: '',
          date: household.data.today,
          repeat: 'never',
        }
        setForm(f)
        setInitial(f)
      }
    }
  }

  // The amount has focus whenever the sheet is open and ready.
  const ready = form != null
  useEffect(() => {
    if (open && ready) amountRef.current?.focus({ preventScroll: true })
  }, [open, ready])

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f))

  const kind = form?.kind ?? options.kind ?? 'expense'
  const minor = form ? amountMinorFromInput(form.amountText, form.currency) : 0

  // Categories of this kind (an archived one being edited stays visible).
  const gridCategories = useMemo(() => {
    const list: { id: string; name: string; color: string; icon: string; kind: EntryKind }[] = (categories.data ?? []).filter(
      (c: Category) => c.kind === kind,
    )
    const own = editTx.data?.category
    if (own && own.kind === kind && !list.some((c) => c.id === own.id)) list.push(own)
    return list
  }, [categories.data, editTx.data, kind])

  // ---- live hint (expenses only) ----
  const budgets = useCurrentBudgets(open && kind === 'expense')
  const foreign = form != null && form.currency !== home
  const fx = useFxQuote({
    from: form?.currency ?? home,
    to: home,
    on: form?.date || today,
    amountMinor: minor,
    enabled: open && kind === 'expense' && foreign && Boolean(form?.date),
  })
  const hint = useMemo(() => {
    if (!form || kind !== 'expense' || !budgets.data) return null
    const period = budgets.data.period
    if (form.date < period.startsOn || form.date >= period.endsBefore) return null
    if (foreign && fx.isError) {
      const e = fx.error
      if (e instanceof ApiError && e.code === 'fx_rate_unavailable')
        return { text: `No exchange rate for ${form.currency} on this day yet`, over: false }
      return null
    }
    const amountHome = !foreign ? minor : minor === 0 ? 0 : fx.data?.amountMinor
    if (amountHome == null) return null
    const b = budgets.data
    const line = [...b.flexible, ...b.fixed, ...b.unbudgeted].find((l) => l.category.id === form.categoryId)
    const original = editTx.data
    const alreadyCounted =
      original &&
      original.status === 'posted' &&
      original.kind === 'expense' &&
      original.category.id === form.categoryId &&
      original.occurredOn >= period.startsOn &&
      original.occurredOn < period.endsBefore
        ? original.homeAmountMinor
        : 0
    return buildHint({ line, amountHomeMinor: amountHome, alreadyCountedMinor: alreadyCounted, homeCurrency: home, approx: foreign && minor > 0, region })
  }, [form, kind, budgets.data, foreign, fx.isError, fx.error, fx.data, minor, editTx.data, home, region])

  // ---- currency menu: account currencies first, then the others ----
  const currencyChoices = useMemo(() => {
    const first = [...new Set([home, ...accountItems.map((a) => a.currency)])]
    const rest = (currencies.data ?? []).filter((c) => !first.includes(c.code)).map((c) => ({ code: c.code, name: c.name }))
    return { first, rest }
  }, [home, accountItems, currencies.data])

  const setKind = (next: EntryKind) => {
    if (!form || next === form.kind) return
    const keep = gridCategoriesFor(next).some((c) => c.id === form.categoryId)
    const picks = pickDefaults({
      kind: next,
      categories: categories.data ?? [],
      accounts: accountItems,
      recent: recentFor(next).data?.items ?? [],
    })
    set({ kind: next, categoryId: keep ? form.categoryId : picks.categoryId })
  }
  const gridCategoriesFor = (k: EntryKind) => (categories.data ?? []).filter((c) => c.kind === k)

  const isDirty =
    form != null && initial != null && (editing ? JSON.stringify(form) !== JSON.stringify(initial) : form.amountText !== '' || form.note.trim() !== '')
  const canSave = form != null && minor > 0 && Boolean(form.categoryId) && Boolean(form.accountId) && Boolean(form.date) && !saving
  const noun = kindNoun(kind)

  const save = async () => {
    if (!form || !canSave || !form.categoryId || !form.accountId) return
    setSaving(true)
    setError(null)
    const title = form.note.trim()
    try {
      if (editing && editTx.data) {
        const t = editTx.data
        const categoryName = gridCategories.find((c) => c.id === form.categoryId)?.name ?? t.category.name
        await unwrap(
          apiClient.PUT('/transactions/{id}', {
            params: { path: { id: t.id } },
            body: {
              kind: form.kind,
              title: title || categoryName,
              note: t.note ?? undefined,
              occurredOn: form.date,
              occurredAt: form.date === t.occurredOn ? (t.occurredAt ?? undefined) : undefined,
              categoryId: form.categoryId,
              accountId: form.accountId,
              amountMinor: minor,
              currency: form.currency,
              rowVersion: t.rowVersion,
            },
          }),
        )
        toast.show({ title: 'Changes saved' })
      } else {
        await unwrap(
          apiClient.POST('/transactions', {
            body: {
              id,
              kind: form.kind,
              title: title || undefined,
              occurredOn: form.date,
              occurredAt: form.date === today ? nowIso() : undefined,
              categoryId: form.categoryId,
              accountId: form.accountId,
              amountMinor: minor,
              currency: form.currency,
              repeat: form.repeat !== 'never' ? { frequency: form.repeat, intervalCount: 1 } : undefined,
            },
          }),
        )
        toast.show({ title: `${noun} added` })
      }
      void invalidateMoney(queryClient)
      onClose()
    } catch (e) {
      const err = e instanceof ApiError ? e : null
      if (err?.code === 'version_conflict' && editing) {
        const fresh = await editTx.refetch()
        if (fresh.data) {
          const f = formFromTransaction(fresh.data)
          setForm(f)
          setInitial(f)
        }
        setError('This transaction was changed on another device. We loaded the latest version — check it and save again.')
      } else if (err?.code === 'fx_rate_unavailable') {
        setError(
          `There’s no exchange rate for ${form.currency} on ${formatDay(form.date, today).replace(/^[A-Z]/, (c) => c.toLowerCase())} yet. Pick another day, or enter the amount in ${home}.`,
        )
      } else if (!err || err.status === 0) {
        setError(`Couldn’t save this ${noun.toLowerCase()}. Check your connection and try again.`)
      } else {
        setError(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const loadFailed = editing ? editTx.isError : categories.isError || accounts.isError || household.isError

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={editing ? `Edit ${noun}` : `New ${noun}`}
      confirmLabel={editing ? 'Save Changes' : `Add ${noun}`}
      confirmVerb={editing ? 'save' : 'add'}
      onConfirm={() => void save()}
      confirmDisabled={!canSave}
      isDirty={isDirty}
      discardTitle={editing ? 'Discard your changes?' : `Discard this ${noun.toLowerCase()}?`}
      initialFocus={amountRef}
    >
      {!form ? (
        loadFailed ? (
          <p role="alert" className="m-0 py-10 text-center text-subhead text-label-2">
            Couldn’t load {editing ? 'this transaction' : 'your categories and accounts'}. Check your connection and try again.
          </p>
        ) : (
          <AddSkeleton />
        )
      ) : (
        <>
          <Segmented<EntryKind> aria-label="Type" options={KIND_OPTIONS} value={form.kind} onChange={setKind} />

          <div className="pt-[26px] pb-[22px] text-center lg:pt-[18px] lg:pb-4">
            <AmountEntry
              inputRef={amountRef}
              text={form.amountText}
              onTextChange={(raw) => set({ amountText: sanitizeAmountInput(raw, form.currency, decimalSep) })}
              decimalSep={decimalSep}
              groupSep={groupSep}
              currency={form.currency}
              currencies={currencyChoices}
              onCurrencyChange={(code) => set({ currency: code, amountText: sanitizeAmountInput(form.amountText, code, decimalSep) })}
            />
            <p
              aria-live="polite"
              className={cn('m-0 mt-2.5 min-h-[18px] text-footnote text-label-2 tabular-nums', hint?.over && 'text-negative')}
            >
              {kind === 'expense' ? hint?.text : null}
            </p>
            {error && (
              <p role="alert" className="m-0 mt-2 text-footnote font-semibold text-negative">
                {error}
              </p>
            )}
          </div>

          <CategoryGrid
            label={kind === 'income' ? 'Income source' : 'Category'}
            categories={gridCategories}
            value={form.categoryId}
            onChange={(categoryId) => set({ categoryId })}
          />

          <List className="mt-5">
            <TextFieldRow
              label="Note"
              placeholder="Merchant or note"
              maxLength={80}
              enterKeyHint="done"
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
            />
            <DateRow value={form.date} today={today} onChange={(date) => set({ date })} />
            <SelectRow
              label="Account"
              value={form.accountId ?? ''}
              options={accountItems.map((a) => ({ value: a.id, label: a.name }))}
              onValueChange={(accountId) => {
                const account = accountItems.find((a) => a.id === accountId)
                set({
                  accountId,
                  currency: account?.currency ?? form.currency,
                  amountText: sanitizeAmountInput(form.amountText, account?.currency ?? form.currency, decimalSep),
                })
              }}
            />
            {!editing && (
              <SelectRow<Repeat>
                label="Repeat"
                value={form.repeat}
                options={REPEAT_OPTIONS}
                onValueChange={(repeat) => set({ repeat })}
              />
            )}
          </List>
          {form.repeat !== 'never' && (
            <p className="m-0 px-4 pt-2 text-footnote text-label-2">
              Repeats {form.repeat === 'weekly' ? 'every week' : form.repeat === 'monthly' ? 'every month' : 'every year'}{' '}
              from this date. You’ll find it in Subscriptions.
            </p>
          )}
        </>
      )}
    </ResponsiveSheet>
  )
}

/** Date row: "Today" / "Yesterday" / "Mon 16 Nov"; the native date picker sits on top of it. */
function DateRow({ value, today, onChange }: { value: string; today: string; onChange: (date: string) => void }) {
  const label = value ? formatDay(value, today || undefined) : 'Choose'
  return (
    <label className={cn(rowClasses({ hasLeading: false, interactive: true }), 'relative')}>
      <span className="flex-none text-body">Date</span>
      <span className="min-w-0 flex-1" />
      <span className="truncate text-body text-label-2">{label}</span>
      <RowAccessory kind="disclosure" />
      <input
        type="date"
        aria-label={`Date: ${label}`}
        value={value}
        required
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value)
        }}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // not allowed here (e.g. inside an iframe): the native control still opens on tap
          }
        }}
        className="absolute inset-0 h-full w-full cursor-default text-[16px] opacity-0"
      />
    </label>
  )
}

/** Loading shape: segmented, amount, the category grid and the details list. */
function AddSkeleton() {
  return (
    <div aria-busy>
      <span className="sr-only" role="status">
        Loading…
      </span>
      <SkeletonBlock className="h-[34px] w-full rounded-full" />
      <div className="flex justify-center pt-[26px] pb-[22px] lg:pt-[18px] lg:pb-4">
        <SkeletonBlock className="h-[52px] w-40 rounded-sm lg:h-11" />
      </div>
      <List className="grid grid-cols-4 gap-1.5 px-2 py-3.5">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="flex flex-col items-center gap-2 py-1.5">
            <SkeletonBlock className="size-10 rounded-[11px]" />
            <SkeletonBlock className="h-2.5 w-12" />
          </span>
        ))}
      </List>
      <List className="mt-5">
        {['Note', 'Date', 'Account', 'Repeat'].map((l) => (
          <div key={l} className={rowClasses({ hasLeading: false })}>
            <span className="flex-1 text-body text-label-3">{l}</span>
            <SkeletonBlock className="h-3.5 w-16" />
          </div>
        ))}
      </List>
    </div>
  )
}
