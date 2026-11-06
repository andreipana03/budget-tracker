import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { List } from './List'
import { rowClasses } from './row-classes'

/** A fill-4 placeholder block. Size it with classes. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block rounded-xs bg-fill-4 motion-safe:animate-pulse', className)} />
}

/**
 * Loading rows with the exact shape of the real rows (design § 6.16: no spinners
 * for local data). Renders its own List unless `bare`.
 *
 *   {isPending ? <SkeletonRows count={4} variant="double" /> : <List>…</List>}
 */
export function SkeletonRows({
  count = 3,
  variant = 'single',
  bare,
  label = 'Loading',
  className,
}: {
  count?: number
  variant?: 'single' | 'double' | 'budget'
  /** Render rows only (inside an existing List). */
  bare?: boolean
  label?: string
  className?: string
}) {
  const rows = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      aria-hidden
      className={cn(
        rowClasses({ size: variant === 'double' ? 'double' : 'single' }),
        variant === 'budget' && 'items-start py-3',
      )}
    >
      <SkeletonBlock
        className={cn(
          variant === 'double' ? 'size-10 rounded-[11px] lg:size-9 lg:rounded-[9px]' : 'size-[30px] rounded-tile lg:size-7',
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex justify-between gap-4">
          <SkeletonBlock className={cn('h-3.5', i % 2 ? 'w-24' : 'w-32')} />
          {variant !== 'double' && <SkeletonBlock className="h-3.5 w-16" />}
        </span>
        {variant === 'double' && <SkeletonBlock className="h-3 w-40 max-w-full" />}
        {variant === 'budget' && (
          <>
            <SkeletonBlock className="h-1.5 w-full rounded-full" />
            <SkeletonBlock className="h-3 w-28" />
          </>
        )}
      </span>
      {variant === 'double' && <SkeletonBlock className="h-3.5 w-16" />}
    </div>
  ))
  const status = <span className="sr-only" role="status">{label}…</span>
  if (bare)
    return (
      <>
        {status}
        {rows}
      </>
    )
  return (
    <List aria-busy className={className}>
      {status}
      {rows}
    </List>
  )
}

/**
 * Empty state, centered in the content area (design § 6.16).
 *
 *   <EmptyState icon="receipt" title="No Expenses Yet"
 *     message="Add your first expense with the + button."
 *     action={{ label: 'Add Expense', onClick: () => addSheet.open() }} />
 */
export function EmptyState({
  icon = 'receipt',
  title,
  message,
  action,
  className,
}: {
  icon?: IconName
  /** Title case: "No Expenses Yet", "No Results for “Lidl”". */
  title: string
  /** One sentence: "Add your first expense with the + button." */
  message?: ReactNode
  /** The prominent action, if there is one. */
  action?: { label: string; onClick: () => void; icon?: IconName }
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span aria-hidden className="grid size-12 place-items-center rounded-[13px] bg-fill-3 text-[26px] text-label-2">
        <Icon name={icon} />
      </span>
      <h2 className="mt-4 mb-0 text-title-3">{title}</h2>
      {message && <p className="m-0 mt-1 max-w-[320px] text-subhead text-label-2">{message}</p>}
      {action && (
        <Button variant="prominent" icon={action.icon} onClick={action.onClick} className="mt-5">
          {action.label}
        </Button>
      )}
    </div>
  )
}

/**
 * Inline, recoverable error in the app's voice (design § 6.16) — never an alert.
 *
 *   <InlineError what="your budgets" onRetry={refetch} />
 *   → "Couldn't load your budgets. Check your connection and try again. · Try Again"
 */
export function InlineError({
  what,
  message,
  onRetry,
  className,
}: {
  /** "your budgets", "this transaction" — completes "Couldn't load …". */
  what?: string
  /** Replaces the whole sentence. */
  message?: string
  onRetry?: () => void
  className?: string
}) {
  const sentence = message ?? `Couldn’t load ${what ?? 'this'}. Check your connection and try again.`
  return (
    <div
      role="alert"
      className={cn('flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-lg bg-surface px-4 py-3 lg:rounded-md lg:shadow-card', className)}
    >
      <Icon name="warning-circle" weight="fill" className="mr-1 text-[18px] text-label-2" />
      <span className="text-subhead text-label-2 lg:text-callout">{sentence}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-2 py-2 text-subhead font-semibold text-tint-text lg:text-callout"
        >
          Try Again
        </button>
      )}
    </div>
  )
}
