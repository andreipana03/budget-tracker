/**
 * Shared data hooks for the shell and every screen. Typed from the generated
 * OpenAPI paths; errors are thrown as `ApiError` (code + readable message).
 *
 *   const { data: accounts, isPending, isError, refetch } = useAccounts()
 *
 * Invalidate after writes with the keys below:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
 *
 * Screen-specific queries (home, budgets, insights, transactions…) live in each
 * feature's `use<Name>.ts`; reuse `unwrap` and add their keys here only if shared.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query'

import { apiClient } from './client'
import { unwrap } from './errors'
import type { components } from './schema.gen'

export { ApiError, isFinalError, toApiError, unwrap } from './errors'

export type User = components['schemas']['User']
export type Household = components['schemas']['Household']
export type Currency = components['schemas']['Currency']
export type Account = components['schemas']['Account']
export type AccountList = components['schemas']['AccountList']
export type Category = components['schemas']['Category']
export type CategoryRef = components['schemas']['CategoryRef']
export type Subscription = components['schemas']['Subscription']
export type SubscriptionList = components['schemas']['SubscriptionList']

export const queryKeys = {
  me: ['me'] as const,
  household: ['household'] as const,
  currencies: ['currencies'] as const,
  /** Prefix for every accounts query. */
  accounts: ['accounts'] as const,
  accountsList: (includeArchived = false) => ['accounts', { includeArchived }] as const,
  /** Prefix for every categories query. */
  categories: ['categories'] as const,
  categoriesList: (includeArchived = false) => ['categories', { includeArchived }] as const,
  subscriptions: ['subscriptions'] as const,
  // Screen queries (hooks live in each feature's use<Name>.ts). Keep these shapes so
  // invalidateMoney() refreshes every screen after a write, whichever feature made it.
  /** ['home', month] — month is 'YYYY-MM' or 'current'. */
  home: (month = 'current') => ['home', month] as const,
  /** ['budgets', month] */
  budgets: (month = 'current') => ['budgets', month] as const,
  months: ['months'] as const,
  /** ['insights', period, categoryId?] */
  insights: (period: string, categoryId?: string) => ['insights', period, categoryId ?? 'all'] as const,
  /** ['transactions', filters] — infinite list; filters is a plain object. */
  transactions: (filters: Record<string, unknown> = {}) => ['transactions', filters] as const,
  /** ['transaction', id] */
  transaction: (id: string) => ['transaction', id] as const,
}

/**
 * Call after any write that moves money or changes how it's grouped (transactions,
 * budgets, subscriptions, accounts, categories, household settings): refreshes every
 * screen that shows it. Cheap: only active queries refetch right away.
 */
export function invalidateMoney(queryClient: QueryClient) {
  const prefixes = ['home', 'budgets', 'months', 'insights', 'transactions', 'transaction',
    'accounts', 'categories', 'subscriptions', 'household']
  return Promise.all(prefixes.map((p) => queryClient.invalidateQueries({ queryKey: [p] })))
}

/** The signed-in user (`region` decides number formatting). */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => unwrap(apiClient.GET('/me')) })
}

/** Household settings: home currency, time zone, month start day, `today`, `currentMonth`. */
export function useHousehold() {
  return useQuery({ queryKey: queryKeys.household, queryFn: () => unwrap(apiClient.GET('/household')) })
}

/** Supported currencies with their minor units. Rarely changes. */
export function useCurrencies() {
  return useQuery({
    queryKey: queryKeys.currencies,
    queryFn: () => unwrap(apiClient.GET('/currencies')),
    staleTime: 24 * 60 * 60 * 1000,
  })
}

/** Accounts with balances and the ≈ total in the home currency (sidebar, Add sheet). */
export function useAccounts({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.accountsList(includeArchived),
    queryFn: () => unwrap(apiClient.GET('/accounts', { params: { query: { includeArchived } } })),
  })
}

/** Expense and income categories in sort order. */
export function useCategories({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.categoriesList(includeArchived),
    queryFn: () => unwrap(apiClient.GET('/categories', { params: { query: { includeArchived } } })),
  })
}

/** Subscriptions with totals, next 7 days, later, paused and the pending count. */
export function useSubscriptions() {
  return useQuery({ queryKey: queryKeys.subscriptions, queryFn: () => unwrap(apiClient.GET('/subscriptions')) })
}
