import { tileGlyphClass, tileVar } from '@/lib/categories'
import { cn } from '@/lib/utils'

import { Icon } from './Icon'

export type TileSize = 20 | 30 | 40 | 52

/* Compact size → classes. Desktop shrinks rows' tiles slightly, like the prototype
   (30 → 28, 40 → 36) and grows the inspector tile (48 → 52). Radius ≈ 27% squircle. */
const SIZE: Record<TileSize, { box: string; glyph: string; mono: string }> = {
  20: { box: 'size-5 rounded-xs', glyph: 'text-[12px]', mono: 'text-[11px]' },
  30: { box: 'size-[30px] rounded-tile lg:size-7 lg:rounded-[7px]', glyph: 'text-[18px] lg:text-[16px]', mono: 'text-[17px] lg:text-[15px]' },
  40: { box: 'size-10 rounded-[11px] lg:size-9 lg:rounded-[9px]', glyph: 'text-[22px] lg:text-[20px]', mono: 'text-[19px] lg:text-[17px]' },
  52: { box: 'size-12 rounded-[13px] lg:size-[52px]', glyph: 'text-[26px] lg:text-[28px]', mono: 'text-[24px] lg:text-[26px]' },
}

export interface CategoryTileProps {
  /** Category hue from the API (`mint`, `orange`, …). */
  color: string
  /** Phosphor kebab name from the API (`shopping-cart`). Ignored when `monogram` is set. */
  icon?: string
  /** 20 inline · 30 rows · 40 two-line rows & chips · 52 inspector header. */
  size?: TileSize
  /** First letter instead of an icon (subscriptions, merchants). Never a logo. */
  monogram?: string
  className?: string
}

/**
 * Category tile (design § 6.6). Decorative: always `aria-hidden`, so the category
 * name must sit next to it in text.
 *
 *   <CategoryTile color="mint" icon="shopping-cart" />
 *   <CategoryTile color="purple" monogram="N" size={40} />
 */
export function CategoryTile({ color, icon, size = 30, monogram, className }: CategoryTileProps) {
  const s = SIZE[size]
  return (
    <span
      aria-hidden
      className={cn('grid flex-none place-items-center', s.box, tileGlyphClass(color), className)}
      style={{ background: tileVar(color) }}
    >
      {monogram ? (
        <span className={cn('font-rounded leading-none font-bold', s.mono)}>{monogram.slice(0, 1).toUpperCase()}</span>
      ) : (
        <Icon name={icon ?? 'dots-three'} variant="tile" className={s.glyph} />
      )}
    </span>
  )
}
