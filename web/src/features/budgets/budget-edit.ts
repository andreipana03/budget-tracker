/**
 * Edit Budgets form logic: typed text per category → the PUT /budgets items.
 * Only changed categories are sent; a cleared field sends `null` (no limit).
 */
import type { components } from '@/lib/api/schema.gen'
import { parseAmount, toAmountInput } from '@/lib/format'

export type BudgetMonth = components['schemas']['BudgetMonth']
export type BudgetLine = components['schemas']['BudgetLine']
export type BudgetLimitInput = components['schemas']['BudgetLimitInput']
export type BudgetScope = components['schemas']['SetBudgetsRequest']['scope']

export const INVALID_AMOUNT = 'Enter an amount like 250 or 250,50.'

/** Every budget line of the month, flexible, fixed and unbudgeted. */
export function allLines(month: Pick<BudgetMonth, 'flexible' | 'fixed' | 'unbudgeted'>): BudgetLine[] {
  return [...month.flexible, ...month.fixed, ...month.unbudgeted]
}

/** categoryId → this month's limit (null = none). */
export function currentLimits(
  month: Pick<BudgetMonth, 'flexible' | 'fixed' | 'unbudgeted'>,
): Record<string, number | null> {
  return Object.fromEntries(allLines(month).map((l) => [l.category.id, l.limitMinor]))
}

/** The text each field starts with: "300", "250,50", or "" for no limit. */
export function initialDrafts(
  limits: Record<string, number | null>,
  currency: string,
  region?: string | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(limits).map(([id, minor]) => [id, minor == null ? '' : toAmountInput(minor, currency, { region })]),
  )
}

/** One field's text → minor units, `null` for empty (no limit), `undefined` when invalid. */
export function parseLimit(text: string, currency: string): number | null | undefined {
  if (text.trim() === '') return null
  return parseAmount(text, currency) ?? undefined
}

export interface BudgetDiff {
  /** Changed categories only, in the order given. */
  items: BudgetLimitInput[]
  /** categoryId → message for fields that don't parse. */
  errors: Record<string, string>
  /** Sum of every field that has a valid amount (the live total). */
  totalMinor: number
}

/**
 * Compare the typed drafts with the current limits.
 *
 *   diffBudgets({ a: 30000, b: null }, { a: '300', b: '50' }, 'RON')
 *   → { items: [{ categoryId: 'b', amountMinor: 5000 }], errors: {}, totalMinor: 35000 }
 */
export function diffBudgets(
  limits: Record<string, number | null>,
  drafts: Record<string, string>,
  currency: string,
  order: string[] = Object.keys(drafts),
): BudgetDiff {
  const items: BudgetLimitInput[] = []
  const errors: Record<string, string> = {}
  let totalMinor = 0
  for (const id of order) {
    const text = drafts[id] ?? ''
    const parsed = parseLimit(text, currency)
    const before = limits[id] ?? null
    if (parsed === undefined) {
      errors[id] = INVALID_AMOUNT
      if (before != null) totalMinor += before
      continue
    }
    if (parsed != null) totalMinor += parsed
    if (parsed !== before) items.push({ categoryId: id, amountMinor: parsed })
  }
  return { items, errors, totalMinor }
}
