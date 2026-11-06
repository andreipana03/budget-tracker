import { useMutation, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api/client'
import { invalidateMoney, unwrap } from '@/lib/api/queries'
import type { components } from '@/lib/api/schema.gen'

export type CreateSubscriptionRequest = components['schemas']['CreateSubscriptionRequest']
export type UpdateSubscriptionRequest = components['schemas']['UpdateSubscriptionRequest']

/** POST / PUT (with rowVersion) / DELETE a subscription; every write refreshes money screens. */
export function useSubscriptionMutations() {
  const queryClient = useQueryClient()
  const onSettled = () => invalidateMoney(queryClient)

  const create = useMutation({
    mutationFn: (body: CreateSubscriptionRequest) => unwrap(apiClient.POST('/subscriptions', { body })),
    onSettled,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSubscriptionRequest }) =>
      unwrap(apiClient.PUT('/subscriptions/{id}', { params: { path: { id } }, body })),
    onSettled,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(apiClient.DELETE('/subscriptions/{id}', { params: { path: { id } } })),
    onSettled,
  })
  return { create, update, remove }
}
