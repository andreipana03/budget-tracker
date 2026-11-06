import type { IconWeight } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'

import { ICONS, iconWeight, isIconName, VARIANT_SIZE, type IconName, type IconVariant } from './icons'

export type { IconName, IconVariant } from './icons'


export interface IconProps {
  /** Kebab-case Phosphor name ("shopping-cart"). Unknown names (e.g. from the API) render `dots-three`. */
  name: IconName | (string & {})
  variant?: IconVariant
  /** Overrides the variant's weight. Prefer the variant. */
  weight?: IconWeight
  /** px or any CSS length. Default: the variant's size, else 1em (follows font-size). */
  size?: number | string
  className?: string
  /** Accessible name. Without it the icon is decorative (`aria-hidden`). */
  label?: string
}

/**
 * Phosphor icon with the design's weight rules.
 *
 *   <Icon name="house" variant="tab" />                  // fill, 26px
 *   <Icon name="caret-right" className="text-label-3" />  // bold, 1em
 *   <Icon name={category.icon} variant="tile" size={18} />
 */
export function Icon({ name, variant = 'inline', weight, size, className, label }: IconProps) {
  const key: IconName = isIconName(name) ? name : 'dots-three'
  const Component = ICONS[key]
  return (
    <Component
      weight={weight ?? iconWeight(key, variant)}
      size={size ?? VARIANT_SIZE[variant] ?? '1em'}
      className={cn('block flex-none', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  )
}
