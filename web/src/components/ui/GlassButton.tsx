import type { ComponentProps } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

import { Icon, type IconName } from './Icon'

type GlassButtonProps = {
  /** Icon-only circle. Requires `label` (the action, e.g. "Back to Insights"). */
  icon?: IconName
  /** Accessible name for icon-only buttons. */
  label?: string
  /** Text capsule instead of a circle ("Edit"). */
  text?: string
  /** Tinted glass — the ONE primary action per view (sheet confirm ✓). */
  prominent?: boolean
  /** Navigate instead of acting. */
  to?: string
  className?: string
} & Omit<ComponentProps<'button'>, 'children' | 'className'>

/**
 * Floating glass button for the functional layer only (design § 6.2): compact top
 * bar and sheet bar. 44px — the compact hit target.
 *
 *   <GlassButton icon="user-circle" label="Profile and Settings" to="/settings" />
 *   <GlassButton text="Edit" onClick={…} />
 *   <GlassButton icon="check" label="Add Expense" prominent onClick={…} />
 */
export function GlassButton({ icon, label, text, prominent, to, className, type = 'button', ...rest }: GlassButtonProps) {
  const classes = cn(
    'glass inline-grid h-11 min-w-11 flex-none place-items-center rounded-full text-[21px] text-label',
    'transition-[transform,opacity] duration-(--dur-press) ease-out active:scale-94 hover:brightness-97',
    'disabled:opacity-40 disabled:active:scale-100',
    text && 'px-4 text-body font-semibold',
    prominent && 'glass-prominent text-on-tint',
    className,
  )
  const content = (
    <>
      {icon && <Icon name={icon} variant="topbar" size="1em" />}
      {text}
    </>
  )
  if (to)
    return (
      <Link to={to} className={classes} aria-label={text ? undefined : label}>
        {content}
      </Link>
    )
  return (
    <button type={type} className={classes} aria-label={text ? undefined : label} {...rest}>
      {content}
    </button>
  )
}
