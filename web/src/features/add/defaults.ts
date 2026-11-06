/**
 * Add sheet defaults (plan › "Behaviour the docs leave open › Add defaults"):
 * category and account come from the most recent MANUAL transaction of that kind
 * (subscription charges don't count), else the first one in sort order. A category
 * passed in by the caller (e.g. from Category detail) wins.
 */
import type { components } from '@/lib/api/schema.gen'

type Kind = components['schemas']['EntryKind']

export interface PickDefaultsInput {
  kind: Kind
  /** Active categories of both kinds, in sort order. */
  categories: readonly { id: string; kind: Kind }[]
  /** Active accounts, in sort order. */
  accounts: readonly { id: string }[]
  /** Recent transactions, newest first (GET /transactions?kind=&limit=20). */
  recent: readonly { kind: Kind; recurringId: string | null; category: { id: string }; account: { id: string } }[]
  presetCategoryId?: string
}

export function pickDefaults({ kind, categories, accounts, recent, presetCategoryId }: PickDefaultsInput): {
  categoryId: string | null
  accountId: string | null
} {
  const ofKind = categories.filter((c) => c.kind === kind)
  const last = recent.find((t) => t.kind === kind && t.recurringId == null)

  let categoryId: string | null = null
  if (presetCategoryId && ofKind.some((c) => c.id === presetCategoryId)) categoryId = presetCategoryId
  else if (last && ofKind.some((c) => c.id === last.category.id)) categoryId = last.category.id
  else categoryId = ofKind[0]?.id ?? null

  let accountId: string | null = null
  if (last && accounts.some((a) => a.id === last.account.id)) accountId = last.account.id
  else accountId = accounts[0]?.id ?? null

  return { categoryId, accountId }
}
