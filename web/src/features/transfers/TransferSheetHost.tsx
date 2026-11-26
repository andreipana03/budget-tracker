import { Menu as BaseMenu } from '@base-ui/react/menu'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { useTransferSheet, type TransferSheetOptions } from '@/app/transfer-sheet'
import { TextFieldRow } from '@/components/ui/FormRows'
import { Icon } from '@/components/ui/Icon'
import { List, RowAccessory } from '@/components/ui/List'
import { MenuPopup, MenuRadioGroup, MenuRadioItem } from '@/components/ui/Menu'
import { ResponsiveSheet } from '@/components/ui/ResponsiveSheet'
import { rowClasses } from '@/components/ui/row-classes'
import { EmptyState, SkeletonBlock } from '@/components/ui/States'
import { useToast } from '@/components/ui/use-toast'
import { useDebouncedValue } from '@/features/activity/hooks'
import { amountMinorFromInput, groupSeparator, sanitizeAmountInput } from '@/features/add/amount-entry'
import { AmountEntry } from '@/features/add/AmountEntry'
import { DateRow } from '@/features/add/DateRow'
import { uuidv7 } from '@/features/add/uuidv7'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'
import { invalidateMoney, useAccounts, useHousehold, type Account } from '@/lib/api/queries'
import { currencySymbol, decimalSeparator, formatDay, formatMoney, toAmountInput, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { balanceAfter, impliedRate, isExchange, pickTransferAccounts, rateText, type Transfer } from './transfers'
import { useTransfer } from './useTransfers'

interface FormState {
  /** What leaves `fromId`, in its currency. */
  amountText: string
  fromId: string | null
  toId: string | null
  /** Between currencies: what arrived, as typed. null follows the BNR rate. */
  receivedText: string | null
  note: string
  date: string
}

/** Entry time for a transfer dated today (the desktop table shows it). */
const nowIso = () => new Date().toISOString()

/**
 * The global Transfer sheet, the Add sheet's sibling (same ResponsiveSheet: slides up on
 * compact with the page receding, fades in as a dialog on desktop). Opened with
 * useTransferSheet().open({ transferId?, fromAccountId?, toAccountId? }) from Home ›
 * Accounts, Settings › Accounts, the sidebar, T, and a transfer's Edit. Each open is a
 * fresh form.
 */
export function TransferSheetHost() {
  const { state, close } = useTransferSheet()
  if (state.session === 0) return null
  return <TransferSheet key={state.session} open={state.isOpen} options={state.options} onClose={close} />
}

function TransferSheet({ open, options, onClose }: { open: boolean; options: TransferSheetOptions; onClose: () => void }) {
  const region = useRegion()
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const editingId = options.transferId
  const editing = Boolean(editingId)

  const household = useHousehold()
  // Archived accounts too: a transfer being edited may use one (it stays offered for it).
  const accounts = useAccounts({ includeArchived: true })
  const editTr = useTransfer(editingId)
  const original = editTr.data

  const amountRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [initial, setInitial] = useState<FormState | null>(null)
  const [id] = useState(() => uuidv7()) // one id per form: retries stay idempotent
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const decimalSep = decimalSeparator({ region })
  const groupSep = groupSeparator(region)
  const today = household.data?.today ?? ''
  const home = household.data?.homeCurrency ?? 'RON'
  const all = accounts.data?.items ?? []
  const choices = all.filter((a) => !a.archived || a.id === original?.fromAccount.id || a.id === original?.toAccount.id)
  const activeCount = all.filter((a) => !a.archived).length

  const formFromTransfer = (tr: Transfer): FormState => ({
    amountText: toAmountInput(tr.fromAmountMinor, tr.fromAccount.currency, { region }),
    fromId: tr.fromAccount.id,
    toId: tr.toAccount.id,
    receivedText: isExchange(tr) ? toAmountInput(tr.toAmountMinor, tr.toAccount.currency, { region }) : null,
    note: tr.note ?? '',
    date: tr.occurredOn,
  })

  // Initialise once the data it depends on is here (adjusting state during render).
  if (!form && accounts.data && household.data) {
    if (editing) {
      if (editTr.data) {
        const f = formFromTransfer(editTr.data)
        setForm(f)
        setInitial(f)
      }
    } else {
      const picks = pickTransferAccounts(accounts.data.items, options)
      const f: FormState = { amountText: '', fromId: picks.fromId, toId: picks.toId, receivedText: null, note: '', date: household.data.today }
      setForm(f)
      setInitial(f)
    }
  }

  const ready = form != null
  useEffect(() => {
    if (open && ready) amountRef.current?.focus({ preventScroll: true })
  }, [open, ready])

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f))

  const from = choices.find((a) => a.id === form?.fromId)
  const to = choices.find((a) => a.id === form?.toId)
  const fromCurrency = from?.currency ?? home
  const toCurrency = to?.currency ?? fromCurrency
  const exchange = from != null && to != null && from.currency !== to.currency
  const sendMinor = form ? amountMinorFromInput(form.amountText, fromCurrency) : 0
  const date = form?.date || today

  // ---- between currencies: what arrives, at that day's BNR rate unless typed ----
  const settledSend = useDebouncedValue(sendMinor, 300)
  const quote = useQuery({
    queryKey: ['fx', fromCurrency, toCurrency, date, settledSend] as const,
    queryFn: ({ signal }) =>
      unwrap(
        apiClient.GET('/fx/quote', {
          params: { query: { from: fromCurrency, to: toCurrency, on: date, amountMinor: settledSend } },
          signal,
        }),
      ),
    enabled: open && exchange && settledSend > 0 && Boolean(date),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const quoteForPair = quote.data && quote.data.from === fromCurrency && quote.data.to === toCurrency ? quote.data : undefined
  const quoteCurrent = quoteForPair && !quote.isPlaceholderData && settledSend === sendMinor ? quoteForPair : undefined
  const noRate = exchange && quote.error instanceof ApiError && quote.error.code === 'fx_rate_unavailable'
  const following = form?.receivedText == null
  const receivedText = !exchange
    ? ''
    : !following
      ? (form?.receivedText ?? '')
      : sendMinor > 0 && quoteForPair?.amountMinor != null && !noRate
        ? toAmountInput(quoteForPair.amountMinor, toCurrency, { region })
        : ''
  const receiveMinor = !exchange
    ? sendMinor
    : following
      ? (quoteCurrent?.amountMinor ?? 0)
      : amountMinorFromInput(receivedText, toCurrency)

  // ---- picking accounts: choosing the other side's account swaps them ----
  const changeAccounts = (next: { fromId: string | null; toId: string | null }) => {
    if (!form) return
    const nextFrom = choices.find((a) => a.id === next.fromId)
    const nextTo = choices.find((a) => a.id === next.toId)
    const sameCurrencies = nextFrom?.currency === from?.currency && nextTo?.currency === to?.currency
    set({
      ...next,
      amountText: sanitizeAmountInput(form.amountText, nextFrom?.currency ?? fromCurrency, decimalSep),
      receivedText: sameCurrencies ? form.receivedText : null,
    })
  }
  const setFrom = (fromId: string) =>
    changeAccounts(fromId === form?.toId ? { fromId, toId: form?.fromId ?? null } : { fromId, toId: form?.toId ?? null })
  const setTo = (toId: string) =>
    changeAccounts(toId === form?.fromId ? { fromId: form?.toId ?? null, toId } : { fromId: form?.fromId ?? null, toId })
  const swap = () => {
    if (!form) return
    // Between currencies the amounts swap too: 100 lei → 20,08 € becomes 20,08 € → ≈ 100 lei.
    const amountText = exchange && receivedText ? sanitizeAmountInput(receivedText, toCurrency, decimalSep) : form.amountText
    set({
      fromId: form.toId,
      toId: form.fromId,
      amountText: sanitizeAmountInput(amountText, toCurrency, decimalSep),
      receivedText: null,
    })
  }

  // ---- live hint: what's left in the account the money leaves ----
  const hint = (() => {
    if (!from || !form) return null
    const after = balanceAfter({ account: from, fromId: form.fromId, toId: form.toId, sendMinor, receiveMinor, original })
    const money = (minor: number) => formatMoney(minor, from.currency, { region })
    if (sendMinor === 0) return `${money(after)} in ${from.name}`
    return after >= 0 ? `Leaves ${money(after)} in ${from.name}` : `This takes ${from.name} ${money(-after)} below zero`
  })()

  const rateLine = (() => {
    if (!exchange) return null
    if (noRate && following) return `There’s no BNR rate for ${formatDay(date, today).replace(/^[A-Z]/, (c) => c.toLowerCase())} yet. Enter what arrived.`
    if (!following) {
      const implied = impliedRate(sendMinor, fromCurrency, receiveMinor, toCurrency)
      const text = implied ? rateText(implied, fromCurrency, toCurrency, { region }) : null
      return text ? `${text} with these amounts.` : 'Enter what arrived, fees included.'
    }
    const text = quoteForPair ? rateText(quoteForPair.rate, fromCurrency, toCurrency, { region }) : null
    return text ? `At the BNR rate, ${text}. Change it to what actually arrived, fees included.` : 'Filled in at the BNR rate once you enter an amount.'
  })()

  const isDirty =
    form != null &&
    initial != null &&
    (editing ? JSON.stringify(form) !== JSON.stringify(initial) : form.amountText !== '' || form.note.trim() !== '' || form.receivedText != null)
  const canSave =
    form != null &&
    from != null &&
    to != null &&
    from.id !== to.id &&
    sendMinor > 0 &&
    Boolean(form.date) &&
    (!exchange || (following ? !noRate : receiveMinor > 0)) &&
    !saving

  const save = async () => {
    if (!form || !canSave || !from || !to) return
    setSaving(true)
    setError(null)
    // Following the BNR rate: send the quote when it's for exactly this amount, else let the API convert.
    const toAmountMinor = !exchange ? undefined : following ? quoteCurrent?.amountMinor : receiveMinor
    const note = form.note.trim() || undefined
    try {
      if (editing && original) {
        await unwrap(
          apiClient.PUT('/transfers/{id}', {
            params: { path: { id: original.id } },
            body: {
              fromAccountId: from.id,
              toAccountId: to.id,
              fromAmountMinor: sendMinor,
              toAmountMinor,
              occurredOn: form.date,
              occurredAt: form.date === original.occurredOn ? (original.occurredAt ?? undefined) : undefined,
              note,
              rowVersion: original.rowVersion,
            },
          }),
        )
        toast.show({ title: 'Changes saved' })
      } else {
        await unwrap(
          apiClient.POST('/transfers', {
            body: {
              id,
              fromAccountId: from.id,
              toAccountId: to.id,
              fromAmountMinor: sendMinor,
              toAmountMinor,
              occurredOn: form.date,
              occurredAt: form.date === today ? nowIso() : undefined,
              note,
            },
          }),
        )
        toast.show({ title: 'Transfer added' })
      }
      void invalidateMoney(queryClient)
      onClose()
    } catch (e) {
      const err = e instanceof ApiError ? e : null
      if (err?.code === 'version_conflict' && editing) {
        const fresh = await editTr.refetch()
        if (fresh.data) {
          const f = formFromTransfer(fresh.data)
          setForm(f)
          setInitial(f)
        }
        setError('This transfer was changed on another device. We loaded the latest version — check it and save again.')
      } else if (err?.code === 'fx_rate_unavailable') {
        setError(`There’s no BNR rate for ${toCurrency} on this day yet. Enter what arrived.`)
      } else if (!err || err.status === 0) {
        setError('Couldn’t save this transfer. Check your connection and try again.')
      } else {
        setError(err.fields[0]?.message ?? err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const loadFailed = accounts.isError || household.isError || (editing && editTr.isError)
  const needsAccounts = !editing && form != null && activeCount < 2

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={editing ? 'Edit Transfer' : 'New Transfer'}
      confirmLabel={editing ? 'Save Changes' : 'Add Transfer'}
      confirmVerb={editing ? 'save' : 'add'}
      confirmIcon="check"
      onConfirm={needsAccounts ? undefined : () => void save()}
      confirmDisabled={!canSave}
      isDirty={isDirty}
      discardTitle={editing ? 'Discard your changes?' : 'Discard this transfer?'}
      initialFocus={needsAccounts ? undefined : amountRef}
    >
      {!form ? (
        loadFailed ? (
          <p role="alert" className="m-0 py-10 text-center text-subhead text-label-2">
            Couldn’t load {editing ? 'this transfer' : 'your accounts'}. Check your connection and try again.
          </p>
        ) : (
          <TransferSkeleton />
        )
      ) : needsAccounts ? (
        <EmptyState
          icon="arrows-left-right"
          title="Add Another Account"
          message="Transfers move money between two of your accounts, like from your card to cash."
          action={{
            label: 'Add Account',
            icon: 'plus',
            onClick: () => {
              onClose()
              navigate('/settings/accounts')
            },
          }}
        />
      ) : (
        <>
          <div className="pt-[18px] pb-[22px] text-center lg:pt-3 lg:pb-4">
            <AmountEntry
              inputRef={amountRef}
              label={`Amount to transfer, in ${fromCurrency}`}
              text={form.amountText}
              onTextChange={(raw) => set({ amountText: sanitizeAmountInput(raw, fromCurrency, decimalSep) })}
              decimalSep={decimalSep}
              groupSep={groupSep}
              currency={fromCurrency}
            />
            <p aria-live="polite" className="m-0 mt-2.5 min-h-[18px] text-footnote text-label-2 tabular-nums">
              {hint}
            </p>
            {error && (
              <p role="alert" className="m-0 mt-2 text-footnote font-semibold text-negative">
                {error}
              </p>
            )}
          </div>

          <List className="relative">
            <AccountPickerRow label="From" value={form.fromId} accounts={choices} onChange={setFrom} />
            <AccountPickerRow label="To" value={form.toId} accounts={choices} onChange={setTo} />
            <button
              type="button"
              onClick={swap}
              aria-label="Swap Accounts"
              title="Swap Accounts"
              className="absolute top-1/2 left-[86px] z-1 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-sheet-surface text-[16px] text-tint-text shadow-[0_0_0_0.5px_var(--separator)] transition-transform duration-(--dur-press) ease-out hover:bg-fill-4 active:scale-94"
            >
              <Icon name="arrows-down-up" weight="bold" />
            </button>
          </List>

          {exchange && (
            <>
              <List className="mt-5">
                <label className={cn(rowClasses({ hasLeading: false }), 'cursor-text')}>
                  <span className="flex-none text-body">Received</span>
                  <input
                    aria-label={`Received in ${toCurrency}`}
                    inputMode="decimal"
                    enterKeyHint="done"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={noRate ? 'Amount' : '0'}
                    value={receivedText}
                    onChange={(e) => set({ receivedText: sanitizeAmountInput(e.target.value, toCurrency, decimalSep) })}
                    className="min-w-0 flex-1 border-0 bg-transparent text-right text-body text-label tabular-nums outline-none placeholder:text-placeholder"
                  />
                  <span className="flex-none text-body text-label-2">{currencySymbol(toCurrency, { region })}</span>
                </label>
              </List>
              <p className="m-0 px-4 pt-2 text-footnote text-label-2 lg:px-0.5">
                {rateLine}
                {!following && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => set({ receivedText: null })}
                      className="-my-2 py-2 text-tint-text"
                    >
                      Use BNR Rate
                    </button>
                  </>
                )}
              </p>
            </>
          )}

          <List className="mt-5">
            <TextFieldRow
              label="Note"
              placeholder="ATM, savings…"
              maxLength={500}
              enterKeyHint="done"
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
            />
            <DateRow value={form.date} today={today} onChange={(d) => set({ date: d })} />
          </List>
        </>
      )}
    </ResponsiveSheet>
  )
}

/**
 * "From / To" pop-up row: label, the account's name and ⌃⌄; the menu lists every account
 * with its balance. The label column is fixed and a gap is kept after it, so the swap
 * button sitting on the separator never covers a name.
 */
function AccountPickerRow({
  label,
  value,
  accounts,
  onChange,
}: {
  label: 'From' | 'To'
  value: string | null
  accounts: readonly Account[]
  onChange: (id: string) => void
}) {
  const region = useRegion()
  const current = accounts.find((a) => a.id === value)
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        className={cn(rowClasses({ hasLeading: false, interactive: true }), 'data-popup-open:bg-fill-4')}
        aria-label={`${label}: ${current?.name ?? 'Choose an account'}`}
      >
        <span className="w-14 flex-none text-body">{label}</span>
        <span className="min-w-10 flex-1" />
        <span className="min-w-0 truncate text-body text-label-2">{current?.name ?? 'Choose'}</span>
        <RowAccessory kind="popup" />
      </BaseMenu.Trigger>
      <MenuPopup align="end" className="max-h-[50dvh] overflow-y-auto">
        <MenuRadioGroup value={value ?? ''} onValueChange={(v) => onChange(v as string)}>
          {accounts.map((a) => (
            <MenuRadioItem key={a.id} value={a.id} closeOnClick>
              <span className="flex items-baseline justify-between gap-6">
                <span className="truncate">{a.name}</span>
                <span className="text-label-2 tabular-nums">{formatMoney(a.balanceMinor, a.currency, { region })}</span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </BaseMenu.Root>
  )
}

/** Loading shape: amount, the From/To card and the details list. */
function TransferSkeleton() {
  return (
    <div aria-busy>
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="flex justify-center pt-[18px] pb-[22px] lg:pt-3 lg:pb-4">
        <SkeletonBlock className="h-[52px] w-40 rounded-sm lg:h-11" />
      </div>
      {[['From', 'To'], ['Note', 'Date']].map((labels, i) => (
        <List key={i} className={cn(i > 0 && 'mt-5')}>
          {labels.map((l) => (
            <div key={l} className={rowClasses({ hasLeading: false })}>
              <span className="flex-1 text-body text-label-3">{l}</span>
              <SkeletonBlock className="h-3.5 w-20" />
            </div>
          ))}
        </List>
      ))}
    </div>
  )
}
