/**
 * Transfer helpers shared by the Transfer sheet, Activity rows, the inspector and the
 * detail screen. No UI, no floats: money is minor units, rates are decimal strings.
 */
import { formatRate } from '@/features/activity/transactions'
import type { Account, Transfer } from '@/lib/api/queries'
import { currencySymbol, decimalSeparator, minorUnits } from '@/lib/format'

export type { Transfer } from '@/lib/api/queries'

/** "ING Card → Cash": the row and header title. */
export function transferTitle(tr: Pick<Transfer, 'fromAccount' | 'toAccount'>): string {
  return `${tr.fromAccount.name} → ${tr.toAccount.name}`
}

/** "ING Card to Cash": what screen readers hear instead of the arrow. */
export function transferSpokenTitle(tr: Pick<Transfer, 'fromAccount' | 'toAccount'>): string {
  return `${tr.fromAccount.name} to ${tr.toAccount.name}`
}

/** True when money changed currency on the way (two different amounts). */
export function isExchange(tr: Pick<Transfer, 'fromAccount' | 'toAccount'>): boolean {
  return tr.fromAccount.currency !== tr.toAccount.currency
}

type PickableAccount = Pick<Account, 'id' | 'currency' | 'archived'>

/**
 * Default accounts for a new transfer: the preset ones when they're usable, else the
 * first active account (sort order: usually the main card) to the first other one in
 * the same currency (ING Card → Cash, the everyday ATM withdrawal), else any other.
 */
export function pickTransferAccounts(
  accounts: readonly PickableAccount[],
  preset: { fromAccountId?: string; toAccountId?: string } = {},
): { fromId: string | null; toId: string | null } {
  const active = accounts.filter((a) => !a.archived)
  const usable = (id: string | undefined) => active.find((a) => a.id === id)
  const from = usable(preset.fromAccountId) ?? (preset.toAccountId ? active.find((a) => a.id !== preset.toAccountId) : active[0])
  if (!from) return { fromId: null, toId: null }
  const presetTo = usable(preset.toAccountId)
  const others = active.filter((a) => a.id !== from.id)
  const to = (presetTo && presetTo.id !== from.id ? presetTo : undefined) ?? others.find((a) => a.currency === from.currency) ?? others[0]
  return { fromId: from.id, toId: to?.id ?? null }
}

/**
 * An account's balance once this transfer is saved. When editing, the transfer's
 * current effect is taken out first (it's already in the balance).
 */
export function balanceAfter({
  account,
  fromId,
  toId,
  sendMinor,
  receiveMinor,
  original,
}: {
  account: Pick<Account, 'id' | 'balanceMinor'>
  fromId: string | null
  toId: string | null
  sendMinor: number
  receiveMinor: number
  original?: Pick<Transfer, 'fromAccount' | 'toAccount' | 'fromAmountMinor' | 'toAmountMinor'>
}): number {
  let balance = account.balanceMinor
  if (original) {
    if (original.fromAccount.id === account.id) balance += original.fromAmountMinor
    if (original.toAccount.id === account.id) balance -= original.toAmountMinor
  }
  if (fromId === account.id) balance -= sendMinor
  if (toId === account.id) balance += receiveMinor
  return balance
}

/* ---- exchange rates as people read them: "1 € = 4,98 lei" ---- */

const SCALE_DIGITS = 10
const SCALE = 10n ** BigInt(SCALE_DIGITS)

/** "4.98" → 49800000000n (10 decimals); null when it isn't a plain positive decimal. */
function toScaled(rate: string): bigint | null {
  const [int = '', frac = ''] = rate.trim().split('.')
  if (!/^\d+$/.test(int) || !/^\d*$/.test(frac)) return null
  const v = BigInt(int + frac.padEnd(SCALE_DIGITS, '0').slice(0, SCALE_DIGITS))
  return v > 0n ? v : null
}

function fromScaled(v: bigint): string {
  const s = v.toString().padStart(SCALE_DIGITS + 1, '0')
  return `${s.slice(0, -SCALE_DIGITS)}.${s.slice(-SCALE_DIGITS)}`
}

/** (a / b) at 10 decimals, rounded half up. */
function divide(a: bigint, b: bigint): bigint {
  return (a * SCALE * 2n + b) / (2n * b)
}

/**
 * `rate` is `to` per one `from` (the API's FxQuote.rate). Reads it the way that's ≥ 1:
 * RON → EUR 0.2008 shows as "1 € = 4,98 lei"; EUR → RON 4.98 as "1 € = 4,98 lei" too.
 */
export function rateText(rate: string, from: string, to: string, opts: { region?: string | null } = {}): string | null {
  const scaled = toScaled(rate)
  if (scaled == null) return null
  const sep = decimalSeparator(opts)
  const sym = (c: string) => currencySymbol(c, opts)
  if (scaled >= SCALE) return `1 ${sym(from)} = ${formatRate(fromScaled(scaled), sep)} ${sym(to)}`
  return `1 ${sym(to)} = ${formatRate(fromScaled(divide(SCALE, scaled)), sep)} ${sym(from)}`
}

/**
 * The rate two amounts imply (what the bank really gave, fees included), as a decimal
 * string of `to` per one `from`: 10000 bani → 1990 cents is "0.1990000000".
 */
export function impliedRate(fromMinor: number, from: string, toMinor: number, to: string): string | null {
  if (fromMinor <= 0 || toMinor <= 0) return null
  const num = BigInt(toMinor) * 10n ** BigInt(minorUnits(from))
  const den = BigInt(fromMinor) * 10n ** BigInt(minorUnits(to))
  return fromScaled(divide(num, den))
}
