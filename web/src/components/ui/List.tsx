import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

import { Icon } from './Icon'
import { rowClasses } from './row-classes'

/**
 * Content card (opaque — never glass). `padded` gives the hero/summary padding.
 *
 *   <Card padded>…</Card>
 */
export function Card({ padded, className, ...rest }: ComponentProps<'div'> & { padded?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-surface lg:rounded-md lg:shadow-card',
        padded && 'px-[18px] pt-[18px] pb-5 lg:px-[22px] lg:pt-5 lg:pb-[22px]',
        className,
      )}
      {...rest}
    />
  )
}

/**
 * Grouped list (design § 6.5): a rounded opaque surface holding flush rows.
 * Inside a ResponsiveSheet it switches to the sheet's raised surface automatically.
 *
 *   <List>
 *     <Row … />
 *     <Row … />
 *   </List>
 */
export function List({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('ui-list overflow-hidden rounded-lg bg-surface in-[.ui-sheet]:bg-sheet-surface lg:rounded-md lg:shadow-card in-[.ui-sheet]:lg:shadow-none', className)}
      {...rest}
    />
  )
}

type Accessory = 'disclosure' | 'popup' | 'none'

export interface RowProps {
  /** Usually a <CategoryTile> (30px single-line, 40px two-line). */
  leading?: ReactNode
  title: ReactNode
  /** Second line (`text-subhead label-2`). Presence makes it a two-line row unless `size` says otherwise. */
  subtitle?: ReactNode
  /** Trailing value. Single-line rows show it in `label-2`; two-line rows in `label`. */
  trailing?: ReactNode
  /** Second trailing line (`label-2`), e.g. the converted amount or "Monthly". */
  trailingSub?: ReactNode
  /** Chevron (`disclosure`, push) or pop-up glyph (`popup`, opens a menu). */
  accessory?: Accessory
  size?: 'single' | 'double'
  /** Navigates (react-router Link). */
  to?: string
  onClick?: () => void
  selected?: boolean
  className?: string
  'aria-label'?: string
  'aria-current'?: ComponentProps<'a'>['aria-current']
}

/**
 * List row: single-line (tile 30 · title · value) or two-line (tile 40 · bold
 * title · subtitle · amount). Renders a Link with `to`, a button with `onClick`,
 * else a div. Titles truncate; amounts never do.
 *
 *   <Row leading={<CategoryTile color="mint" icon="shopping-cart" size={40} />}
 *        title="Lidl" subtitle="Groceries · ING Card"
 *        trailing={<Money minor={6430} currency="RON" />} to={`/activity/${id}`} />
 */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  trailingSub,
  accessory = 'none',
  size,
  to,
  onClick,
  selected,
  className,
  ...aria
}: RowProps) {
  const kind = size ?? (subtitle ? 'double' : 'single')
  const interactive = Boolean(to || onClick)
  const classes = cn(rowClasses({ size: kind, hasLeading: Boolean(leading), interactive, selected }), className)

  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-body', kind === 'double' && 'font-semibold')}>{title}</span>
        {subtitle && (
          <span className="flex min-w-0 items-center gap-1 truncate text-subhead text-label-2 lg:text-callout">{subtitle}</span>
        )}
      </span>
      {(trailing || trailingSub) && (
        <span className="flex flex-none flex-col items-end text-right">
          {trailing && (
            <span className={cn('text-body tabular-nums whitespace-nowrap', kind === 'single' && 'text-label-2')}>{trailing}</span>
          )}
          {trailingSub && (
            <span className="text-subhead whitespace-nowrap text-label-2 tabular-nums lg:text-callout">{trailingSub}</span>
          )}
        </span>
      )}
      {accessory !== 'none' && <RowAccessory kind={accessory} />}
    </>
  )

  if (to)
    return (
      <Link to={to} className={classes} {...aria}>
        {body}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={classes} {...aria}>
        {body}
      </button>
    )
  return (
    <div className={classes} {...aria}>
      {body}
    </div>
  )
}

/** Trailing chevron (`CaretRight`) or pop-up (`CaretUpDown`) glyph in `label-3`. */
export function RowAccessory({ kind }: { kind: 'disclosure' | 'popup' }) {
  return (
    <Icon
      name={kind === 'disclosure' ? 'caret-right' : 'caret-up-down'}
      className="-ml-1 flex-none text-[14px] text-label-3"
    />
  )
}
