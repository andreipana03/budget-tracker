/**
 * Settings writes. Every write refreshes what it touches (invalidateMoney for anything
 * money screens show); household edits are optimistic and roll back on failure.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/features/auth/auth-context'
import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import { invalidateMoney, queryKeys, type Account, type Category, type Household } from '@/lib/api/queries'
import type { components } from '@/lib/api/schema.gen'

type Schemas = components['schemas']
export type UpdateMeBody = Schemas['UpdateMeRequest']
export type UpdateHouseholdBody = Schemas['UpdateHouseholdRequest']
export type CreateAccountBody = Schemas['CreateAccountRequest']
export type UpdateAccountBody = Schemas['UpdateAccountRequest']
export type CreateCategoryBody = Schemas['CreateCategoryRequest']
export type UpdateCategoryBody = Schemas['UpdateCategoryRequest']

/** PATCH /me — keeps the session user (region formatting) and the `me` query in sync. */
export function useUpdateMe() {
  const queryClient = useQueryClient()
  const { updateUser } = useAuth()
  return useMutation({
    mutationFn: (body: UpdateMeBody) => unwrap(apiClient.PATCH('/me', { body })),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user)
      updateUser(user)
    },
  })
}

/** PATCH /household — optimistic; money screens refresh after (month boundaries, currency). */
export function useUpdateHousehold() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateHouseholdBody) => unwrap(apiClient.PATCH('/household', { body })),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.household })
      const previous = queryClient.getQueryData<Household>(queryKeys.household)
      if (previous) queryClient.setQueryData<Household>(queryKeys.household, { ...previous, ...body })
      return { previous }
    },
    onError: (_e, _body, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.household, context.previous)
    },
    onSuccess: (household) => queryClient.setQueryData(queryKeys.household, household),
    onSettled: () => invalidateMoney(queryClient),
  })
}

export function useSaveAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; create: CreateAccountBody } | { id: string; update: UpdateAccountBody }): Promise<Account> =>
      'create' in input
        ? unwrap(apiClient.POST('/accounts', { body: { ...input.create, id: input.id } }))
        : unwrap(apiClient.PUT('/accounts/{id}', { params: { path: { id: input.id } }, body: input.update })),
    onSettled: () => invalidateMoney(queryClient),
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.DELETE('/accounts/{id}', { params: { path: { id } } })),
    onSettled: () => invalidateMoney(queryClient),
  })
}

export function useSaveCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; create: CreateCategoryBody } | { id: string; update: UpdateCategoryBody }): Promise<Category> =>
      'create' in input
        ? unwrap(apiClient.POST('/categories', { body: { ...input.create, id: input.id } }))
        : unwrap(apiClient.PUT('/categories/{id}', { params: { path: { id: input.id } }, body: input.update })),
    onSettled: () => invalidateMoney(queryClient),
  })
}

export function useDeleteCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.DELETE('/categories/{id}', { params: { path: { id } } })),
    onSettled: () => invalidateMoney(queryClient),
  })
}

/** After a 409 version_conflict: refetch and return the latest copy of the row. */
export async function refetchLatest<T extends { id: string }>(
  queryClient: ReturnType<typeof useQueryClient>,
  key: readonly unknown[],
  id: string,
  pick: (data: unknown) => T[] | undefined,
): Promise<T | undefined> {
  await queryClient.refetchQueries({ queryKey: key })
  for (const [, data] of queryClient.getQueriesData({ queryKey: key })) {
    const found = pick(data)?.find((x) => x.id === id)
    if (found) return found
  }
  return undefined
}
