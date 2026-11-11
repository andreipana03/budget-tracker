import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'prominent' | 'secondary' | 'plain' | 'destructive' | 'destructive-plain'

const VARIANT: Record<ButtonVariant, string> = {
  prominent: 'bg-tint text-on-tint hover:brightness-108',
  secondary: 'bg-fill-2 text-label hover:bg-fill-1',
  plain: 'bg-transparent px-2 font-normal text-tint-text lg:px-2',
  destructive: 'bg-fill-2 text-negative hover:bg-fill-1',
  'destructive-plain': 'bg-transparent px-2 text-negative lg:px-2',
}

export interface ButtonOwnProps {
  /**
   * `prominent` — the ONE primary action in a view · `secondary` — Cancel, Edit ·
   * `plain` — "See All", inline links · `destructive` — Delete (always confirm or offer Undo).
   */
  variant?: ButtonVariant
  /** `regular`: 50px capsule on compact, 32px rounded-sm on desktop. `small`: 36 / 28px. */
  size?: 'regular' | 'small'
  /** Leading icon (bold glyphs like plus/check are bolded automatically). */
  icon?: IconName
  /** Full width (compact forms). */
  block?: boolean
  children: ReactNode
}

function buttonClasses({ variant = 'secondary', size = 'regular', block }: Pick<ButtonOwnProps, 'variant' | 'size' | 'block'>) {
  return cn(
    'pressable inline-flex items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap',
    'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40',
    size === 'regular' ? 'h-[50px] px-5 text-body lg:h-8 lg:rounded-sm lg:px-3.5' : 'h-9 px-4 text-subhead lg:h-7 lg:rounded-sm lg:px-3 lg:text-body',
    VARIANT[variant],
    block && 'w-full',
  )
}

/**
 * Content button (design § 6.3). Labels are verbs in title case: "Add Expense",
 * "Save Changes", "Delete Transaction" — never "OK" or "Submit".
 *
 *   <Button variant="prominent" icon="plus" onClick={…}>Add Expense</Button>
 *   <Button variant="plain">See All</Button>
 */
export function Button({
  variant,
  size,
  icon,
  block,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonOwnProps & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button type={type} className={cn(buttonClasses({ variant, size, block }), className)} {...rest}>
      {icon && <Icon name={icon} className="text-[1.1em]" />}
      {children}
    </button>
  )
}

/** Same look as Button, rendered as a router Link. */
export function ButtonLink({
  variant,
  size,
  icon,
  block,
  children,
  className,
  ...rest
}: ButtonOwnProps & Omit<ComponentProps<typeof Link>, 'children'>) {
  return (
    <Link className={cn(buttonClasses({ variant, size, block }), className)} {...rest}>
      {icon && <Icon name={icon} className="text-[1.1em]" />}
      {children}
    </Link>
  )
}
