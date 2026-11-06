import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  Button,
  ConfirmDialog,
  Icon,
  List,
  ResponsiveSheet,
  SectionFooter,
  SwitchRow,
  TextFieldRow,
  useToast,
} from '@/components/ui'
import { rowClasses } from '@/components/ui/row-classes'
import { errorMessage, formErrors } from '@/features/auth/field-errors'
import { ApiError } from '@/lib/api/errors'
import { queryKeys, useCurrencies, type Account, type AccountList } from '@/lib/api/queries'
import { currencySymbol, useRegion } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ActionRow, DateRow, Groups, ListError, NativeSelectRow } from './parts'
import { useResetOnOpen } from './use-reset-on-open'
import { ACCOUNT_TYPES, parseSignedAmount, signedAmountInput, type AccountType } from './settings-logic'
import { refetchLatest, useDeleteAccount, useSaveAccount } from './useSettings'

interface Draft {
  name: string
  type: AccountType
  currency: string
  opening: string
  openingOn: string
  includeInTotal: boolean
}

const FIELDS = ['name', 'currency', 'openingBalanceMinor', 'openingBalanceOn'] as const
type Field = (typeof FIELDS)[number]

function draftFrom(account: Account | null, homeCurrency: string, today: string, region: string): Draft {
  if (!account) return { name: '', type: 'bank', currency: homeCurrency, opening: '', openingOn: today, includeInTotal: true }
  return {
    name: account.name,
    type: account.type,
    currency: account.currency,
    opening: signedAmountInput(account.openingBalanceMinor, account.currency, region),
    openingOn: account.openingBalanceOn,
    includeInTotal: account.includeInTotal,
  }
}

/**
 * Add / edit an account: Name, Type, Currency (locked once it has history), Opening
 * Balance + date, Include in Total. Delete archives instead when there's history.
 */
export function AccountSheet({
  open,
  onOpenChange,
  account,
  homeCurrency,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account | null
  homeCurrency: string
  today: string
}) {
  const region = useRegion()
  const toast = useToast()
  const queryClient = useQueryClient()
  const currencies = useCurrencies()
  const save = useSaveAccount()
  const remove = useDeleteAccount()
  const [base, setBase] = useState<Account | null>(account)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(account, homeCurrency, today, region))
  const [errors, setErrors] = useState<Partial<Record<Field, string>> & { form?: string }>({})
  const [currencyLocked, setCurrencyLocked] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newId, setNewId] = useState(() => crypto.randomUUID())

  // Fresh form each time the sheet opens.
  useResetOnOpen(open, () => {
    setBase(account)
    setDraft(draftFrom(account, homeCurrency, today, region))
    setErrors({})
    setCurrencyLocked(false)
    setNewId(crypto.randomUUID())
  })

  const editing = base !== null
  const initial = draftFrom(base, homeCurrency, today, region)
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft)
  const openingMinor = parseSignedAmount(draft.opening, draft.currency)
  const busy = save.isPending || remove.isPending
  const canSave = draft.name.trim().length > 0 && openingMinor !== null && (!editing || dirty) && !busy

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, form: undefined, ...(key === 'name' ? { name: undefined } : {}) }))
  }

  const submit = () => {
    if (!canSave || openingMinor === null) return
    const fields = {
      name: draft.name.trim(),
      type: draft.type,
      currency: draft.currency,
      openingBalanceMinor: openingMinor,
      openingBalanceOn: draft.openingOn || today,
      includeInTotal: draft.includeInTotal,
    }
    const input = base
      ? { id: base.id, update: { ...fields, sortOrder: base.sortOrder, archived: base.archived, rowVersion: base.rowVersion } }
      : { id: newId, create: fields }
    save.mutate(input, {
      onSuccess: () => {
        onOpenChange(false)
        toast.show({ title: base ? 'Account saved' : 'Account added' })
      },
      onError: async (e) => {
        if (e instanceof ApiError && e.code === 'account_currency_locked' && base) {
          setCurrencyLocked(true)
          setDraft((d) => ({ ...d, currency: base.currency }))
          setErrors({ currency: e.message })
          return
        }
        if (e instanceof ApiError && e.code === 'version_conflict' && base) {
          const latest = await refetchLatest<Account>(queryClient, queryKeys.accounts, base.id, (d) => (d as AccountList | undefined)?.items)
          if (latest) {
            setBase(latest)
            setDraft(draftFrom(latest, homeCurrency, today, region))
          }
          setErrors({ form: 'This account was changed on another device. Here’s the latest version: make your changes again.' })
          return
        }
        const mapped = formErrors(e, FIELDS)
        setErrors({ ...mapped.fields, form: mapped.form })
      },
    })
  }

  const doDelete = () => {
    if (!base) return
    setConfirmDelete(false)
    remove.mutate(base.id, {
      onSuccess: (result) => {
        onOpenChange(false)
        toast.show({ title: result.outcome === 'archived' ? 'Account archived (it has history)' : 'Account deleted' })
      },
      onError: (e) => setErrors({ form: errorMessage(e) }),
    })
  }

  const unarchive = () => {
    if (!base) return
    save.mutate(
      {
        id: base.id,
        update: {
          name: base.name,
          type: base.type,
          currency: base.currency,
          openingBalanceMinor: base.openingBalanceMinor,
          openingBalanceOn: base.openingBalanceOn,
          includeInTotal: base.includeInTotal,
          sortOrder: base.sortOrder,
          archived: false,
          rowVersion: base.rowVersion,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast.show({ title: 'Account restored' })
        },
        onError: (e) => setErrors({ form: errorMessage(e) }),
      },
    )
  }

  // Home currency, then the common ones, then the rest A–Z.
  const rank = (code: string) => (code === homeCurrency ? 0 : code === 'EUR' ? 1 : code === 'USD' ? 2 : 3)
  const currencyOptions = [...(currencies.data ?? [{ code: draft.currency, name: draft.currency, minorUnits: 2 }])]
    .sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code))
    .map((c) => ({ value: c.code, label: c.code === c.name ? c.code : `${c.code} · ${c.name}` }))
  const negative = draft.opening.trim().startsWith('-')

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? 'Edit Account' : 'New Account'}
        confirmLabel={editing ? 'Save Changes' : 'Add Account'}
        confirmVerb={editing ? 'save' : 'add'}
        onConfirm={submit}
        confirmDisabled={!canSave}
        isDirty={dirty}
        discardTitle={editing ? 'Discard your changes?' : 'Discard this account?'}
        footerLeading={
          editing && !base?.archived ? (
            <Button variant="destructive" onClick={() => setConfirmDelete(true)} className="lg:rounded-[8px] lg:px-4">
              Delete Account
            </Button>
          ) : undefined
        }
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Groups>
            <div>
              <List>
                <TextFieldRow
                  label="Name"
                  placeholder="ING Card"
                  maxLength={60}
                  enterKeyHint="done"
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  aria-invalid={errors.name ? true : undefined}
                />
              </List>
              {errors.name && <ListError>{errors.name}</ListError>}
            </div>

            <List className="p-2">
              <div role="radiogroup" aria-label="Type" className="grid grid-cols-5 gap-1">
                {ACCOUNT_TYPES.map((t) => {
                  const selected = draft.type === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => set('type', t.value)}
                      className={cn(
                        'flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[14px] px-0.5 py-2 text-caption-1 hover:bg-fill-4',
                        selected ? 'bg-tint-soft font-semibold text-tint-text hover:bg-tint-soft' : 'text-label',
                      )}
                    >
                      <Icon name={t.icon} weight={selected ? 'fill' : 'regular'} className="text-[24px] lg:text-[20px]" />
                      <span className="text-center leading-tight">{t.label}</span>
                    </button>
                  )
                })}
              </div>
            </List>

            <div>
              <List>
                <NativeSelectRow
                  label="Currency"
                  value={draft.currency}
                  options={currencyOptions}
                  onChange={(c) => set('currency', c)}
                  disabled={currencyLocked}
                />
                <div className={cn(rowClasses({ hasLeading: false }), 'cursor-text')}>
                  <label htmlFor="account-opening" className="flex-none text-body">
                    Opening Balance
                  </label>
                  <span className="min-w-0 flex-1" />
                  <button
                    type="button"
                    onClick={() =>
                      set('opening', negative ? draft.opening.trim().slice(1) : `-${draft.opening.trim()}`)
                    }
                    aria-label={negative ? 'Make Positive' : 'Make Negative'}
                    aria-pressed={negative}
                    className="-my-1.5 grid h-8 min-w-8 place-items-center rounded-full bg-fill-3 px-2 text-subhead font-semibold text-label-2"
                  >
                    ±
                  </button>
                  <input
                    id="account-opening"
                    inputMode="decimal"
                    enterKeyHint="done"
                    autoComplete="off"
                    placeholder="0"
                    value={draft.opening}
                    onChange={(e) => set('opening', e.target.value.replace('−', '-'))}
                    aria-invalid={openingMinor === null ? true : undefined}
                    className="w-28 min-w-0 border-0 bg-transparent p-0 text-right text-label tabular-nums outline-none placeholder:text-placeholder"
                  />
                  <span className="flex-none text-body text-label-2">{currencySymbol(draft.currency, { region })}</span>
                </div>
                <DateRow label="Balance On" value={draft.openingOn} max={today} onChange={(e) => set('openingOn', e.target.value)} />
              </List>
              {errors.currency ? (
                <ListError>{errors.currency}</ListError>
              ) : openingMinor === null ? (
                <ListError>Enter an amount like 1.250,50.</ListError>
              ) : errors.openingBalanceMinor || errors.openingBalanceOn ? (
                <ListError>{errors.openingBalanceMinor ?? errors.openingBalanceOn}</ListError>
              ) : (
                <SectionFooter>
                  {currencyLocked
                    ? 'This account has transactions, so its currency can’t change.'
                    : 'What was in the account on that day. Use ± for money you owe, like a credit card balance.'}
                </SectionFooter>
              )}
            </div>

            <div>
              <List>
                <SwitchRow label="Include in Total" checked={draft.includeInTotal} onCheckedChange={(v) => set('includeInTotal', v)} />
              </List>
              <SectionFooter>Counts this balance in the total under Accounts.</SectionFooter>
            </div>

            {errors.form && <ListError>{errors.form}</ListError>}

            {editing && base?.archived && (
              <List>
                <ActionRow onClick={unarchive} disabled={busy}>
                  Unarchive Account
                </ActionRow>
              </List>
            )}
            {editing && !base?.archived && (
              <List className="lg:hidden">
                <ActionRow destructive onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete Account
                </ActionRow>
              </List>
            )}
          </Groups>
          <button type="submit" hidden />
        </form>
      </ResponsiveSheet>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${base?.name ?? ''}”?`}
        message="If it has transactions, it’s archived instead so your history stays."
        confirmLabel="Delete Account"
        destructive
        onConfirm={doDelete}
      />
    </>
  )
}
