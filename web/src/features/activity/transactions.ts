/**
 * Transaction helpers shared by Activity, the detail screen, the inspector and Home › Recent.
 */
import type { components } from '@/lib/api/schema.gen'

export type Transaction = components['schemas']['Transaction']
export type TransactionPage = components['schemas']['TransactionPage']
export type DayTotal = components['schemas']['DayTotal']
export type EntryKind = components['schemas']['EntryKind']

export interface DayGroup {
  date: string
  items: Transaction[]
  /** Posted expenses of the day matching the filters, home currency (from the API's dayTotals). */
  expenseHomeMinor: number
  incomeHomeMinor: number
}

/**
 * Group transactions (already newest first) by calendar day, keeping the API order, and
 * attach each day's totals. Pages can repeat a day (it spans a page boundary): its items
 * merge into one group. Days the API sent no total for fall back to summing posted items.
 */
export function groupByDay(items: readonly Transaction[], dayTotals: readonly DayTotal[]): DayGroup[] {
  const totals = new Map(dayTotals.map((d) => [d.date, d]))
  const groups: DayGroup[] = []
  const byDate = new Map<string, DayGroup>()
  for (const t of items) {
    let g = byDate.get(t.occurredOn)
    if (!g) {
      const total = totals.get(t.occurredOn)
      g = {
        date: t.occurredOn,
        items: [],
        expenseHomeMinor: total?.expenseHomeMinor ?? -1,
        incomeHomeMinor: total?.incomeHomeMinor ?? -1,
      }
      byDate.set(t.occurredOn, g)
      groups.push(g)
    }
    g.items.push(t)
  }
  for (const g of groups) {
    if (g.expenseHomeMinor < 0 || g.incomeHomeMinor < 0) {
      const posted = g.items.filter((t) => t.status === 'posted')
      g.expenseHomeMinor = posted.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.homeAmountMinor, 0)
      g.incomeHomeMinor = posted.filter((t) => t.kind === 'income').reduce((s, t) => s + t.homeAmountMinor, 0)
    }
  }
  return groups
}

/** Merge infinite-query pages into one item list (deduplicated by id) and one dayTotals list. */
export function flattenPages(pages: readonly TransactionPage[]): { items: Transaction[]; dayTotals: DayTotal[] } {
  const seen = new Set<string>()
  const items: Transaction[] = []
  const dayTotals: DayTotal[] = []
  for (const p of pages) {
    for (const t of p.items) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      items.push(t)
    }
    dayTotals.push(...p.dayTotals)
  }
  return { items, dayTotals }
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
