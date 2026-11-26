/**
 * Transaction helpers shared by Activity, the detail screen, the inspector and Home › Recent.
 */
import type { components } from '@/lib/api/schema.gen'

export type Transaction = components['schemas']['Transaction']
export type TransactionPage = components['schemas']['TransactionPage']
export type DayTotal = components['schemas']['DayTotal']
export type EntryKind = components['schemas']['EntryKind']
type Transfer = components['schemas']['Transfer']

/** One row of Activity: a transaction, or money moved between two accounts. */
export type ActivityEntry =
  | { type: 'transaction'; id: string; occurredOn: string; occurredAt: string | null; transaction: Transaction }
  | { type: 'transfer'; id: string; occurredOn: string; occurredAt: string | null; transfer: Transfer }

export interface DayGroup {
  date: string
  items: ActivityEntry[]
  /** Posted expenses of the day matching the filters, home currency (from the API's dayTotals). */
  expenseHomeMinor: number
  incomeHomeMinor: number
}

/**
 * Activity's order, the API's: day desc, then time desc with no time last, then id desc.
 * (Times compare to the millisecond; the id settles anything closer.)
 */
export function compareEntries(a: ActivityEntry, b: ActivityEntry): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn > b.occurredOn ? -1 : 1
  if ((a.occurredAt == null) !== (b.occurredAt == null)) return a.occurredAt == null ? 1 : -1
  if (a.occurredAt != null && b.occurredAt != null) {
    const diff = Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
    if (diff !== 0) return diff
  }
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1
}

/** Transactions and transfers as one list in Activity's order. */
export function activityEntries(items: readonly Transaction[], transfers: readonly Transfer[] = []): ActivityEntry[] {
  const entries: ActivityEntry[] = items.map((t) => ({
    type: 'transaction',
    id: t.id,
    occurredOn: t.occurredOn,
    occurredAt: t.occurredAt,
    transaction: t,
  }))
  for (const tr of transfers) {
    entries.push({ type: 'transfer', id: tr.id, occurredOn: tr.occurredOn, occurredAt: tr.occurredAt, transfer: tr })
  }
  return transfers.length > 0 ? entries.sort(compareEntries) : entries
}

/**
 * Group entries (already in Activity's order) by calendar day and attach each day's
 * totals. Pages can repeat a day (it spans a page boundary): its entries merge into one
 * group. Days the API sent no total for fall back to summing posted transactions.
 * Transfers never count: they're neither spent nor received.
 */
export function groupByDay(entries: readonly ActivityEntry[], dayTotals: readonly DayTotal[]): DayGroup[] {
  const totals = new Map(dayTotals.map((d) => [d.date, d]))
  const groups: DayGroup[] = []
  const byDate = new Map<string, DayGroup>()
  for (const e of entries) {
    let g = byDate.get(e.occurredOn)
    if (!g) {
      const total = totals.get(e.occurredOn)
      g = {
        date: e.occurredOn,
        items: [],
        expenseHomeMinor: total?.expenseHomeMinor ?? -1,
        incomeHomeMinor: total?.incomeHomeMinor ?? -1,
      }
      byDate.set(e.occurredOn, g)
      groups.push(g)
    }
    g.items.push(e)
  }
  for (const g of groups) {
    if (g.expenseHomeMinor < 0 || g.incomeHomeMinor < 0) {
      const posted = g.items.flatMap((e) => (e.type === 'transaction' && e.transaction.status === 'posted' ? [e.transaction] : []))
      g.expenseHomeMinor = posted.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.homeAmountMinor, 0)
      g.incomeHomeMinor = posted.filter((t) => t.kind === 'income').reduce((s, t) => s + t.homeAmountMinor, 0)
    }
  }
  return groups
}

/**
 * Merge infinite-query pages into one list in Activity's order (transactions and, when
 * asked for, transfers; deduplicated by id) and one dayTotals list.
 */
export function flattenPages(pages: readonly TransactionPage[]): { entries: ActivityEntry[]; dayTotals: DayTotal[] } {
  const seen = new Set<string>()
  const items: Transaction[] = []
  const transfers: Transfer[] = []
  const dayTotals: DayTotal[] = []
  for (const p of pages) {
    for (const t of p.items) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      items.push(t)
    }
    for (const tr of p.transfers ?? []) {
      if (seen.has(tr.id)) continue
      seen.add(tr.id)
      transfers.push(tr)
    }
    dayTotals.push(...p.dayTotals)
  }
  return { entries: activityEntries(items, transfers), dayTotals }
}

/** "Expense" / "Income" — for toasts and titles ("Expense deleted"). */
export function kindNoun(kind: EntryKind): 'Expense' | 'Income' {
  return kind === 'income' ? 'Income' : 'Expense'
}

/** True when the amount was entered in another currency than the home one (show the ≈ lei value). */
export function isForeign(t: Pick<Transaction, 'currency' | 'homeCurrency'>): boolean {
  return t.currency !== t.homeCurrency
}

/**
 * The rate as people read it, from the API's decimal string, without floats:
 * "4.9800000000" → "4,98"; "4.97731" → "4,9773" (2–4 decimals, region separator).
 */
export function formatRate(rate: string, decimalSep = ','): string {
  const [int = '0', frac = ''] = rate.trim().split('.')
  if (!/^\d+$/.test(int) || !/^\d*$/.test(frac)) return rate
  // Round half up to 4 decimals with integer math.
  const scaled = (BigInt(int + frac.padEnd(5, '0').slice(0, 5)) + 5n) / 10n
  const s = scaled.toString().padStart(5, '0')
  let f = s.slice(-4).replace(/0+$/, '')
  if (f.length < 2) f = f.padEnd(2, '0')
  return `${s.slice(0, -4)}${decimalSep}${f}`
}

/** A subscription's cadence in words: "Monthly", "Every 2 weeks", … (no subscription → "Never"). */
export function repeatLabel(s: { frequency: 'weekly' | 'monthly' | 'yearly'; intervalCount: number } | undefined): string {
  if (!s) return 'Never'
  const unit = { weekly: 'week', monthly: 'month', yearly: 'year' }[s.frequency]
  if (s.intervalCount > 1) return `Every ${s.intervalCount} ${unit}s`
  return { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[s.frequency]
}
