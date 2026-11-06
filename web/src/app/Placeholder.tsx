import type { ReactNode } from 'react'

import { Card } from '@/components/ui/List'

/** One-line note on placeholder screens (removed as features are built). */
export function PlaceholderNote({ children }: { children: ReactNode }) {
  return (
    <Card padded>
      <p className="m-0 text-subhead text-label-2">{children}</p>
    </Card>
  )
}
