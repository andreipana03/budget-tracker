import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Small capsule label: "Fixed", "Pending", "Paused". `tint` for states that
 * invite an action (Pending). Never the only carrier of meaning.
 *
 *   <Pill>Fixed</Pill>  <Pill tone="tint">Pending</Pill>
 */
export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'tint'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 align-middle text-caption-1 font-semibold whitespace-nowrap',
        tone === 'tint' ? 'bg-tint-soft text-tint-text' : 'bg-fill-3 text-label-2',
        className,
      )}
    >
      {children}
    </span>
  )
}
