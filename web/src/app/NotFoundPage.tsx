import { ButtonLink } from '@/components/ui/Button'

import { Screen } from './Screen'

export function NotFoundPage() {
  return (
    <Screen title="Not Found">
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="m-0 text-subhead text-label-2">There’s nothing at this address.</p>
        <ButtonLink to="/" variant="prominent">
          Go to Home
        </ButtonLink>
      </div>
    </Screen>
  )
}
