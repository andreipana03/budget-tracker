/**
 * Category hue helpers (styles/categories.css). Category colors are identity,
 * never status: don't tint a category red because it's over (design § 4.1).
 *
 *   <span style={{ background: hueVar(category.color) }} />          // bar / chart mark / legend dot
 *   <CategoryTile color={category.color} icon={category.icon} />     // tiles: use the component
 */
import type { components } from '@/lib/api/schema.gen'

export type CategoryColor = components['schemas']['CategoryColor']

export const CATEGORY_COLORS: readonly CategoryColor[] = [
  'mint',
  'orange',
  'indigo',
  'cyan',
  'purple',
  'pink',
  'brown',
  'gray',
  'teal',
  'yellow',
  'green',
]

/** Hues people can pick for an expense category (green is income-only; blue/red are reserved). */
export const EXPENSE_CATEGORY_COLORS: readonly CategoryColor[] = CATEGORY_COLORS.filter((c) => c !== 'green')

function known(color: string | null | undefined): CategoryColor {
  return (CATEGORY_COLORS as readonly string[]).includes(color ?? '') ? (color as CategoryColor) : 'gray'
}

/** Bar / chart-mark color (adapts to dark): `var(--hue-mint)`. Unknown hues fall back to gray. */
export function hueVar(color: string | null | undefined): string {
  return `var(--hue-${known(color)})`
}

/** Tile background (same in light and dark): `var(--hue-mint-tile)`. */
export function tileVar(color: string | null | undefined): string {
  return `var(--hue-${known(color)}-tile)`
}

/** Glyph color class for a tile of this hue: black on yellow, white otherwise. */
export function tileGlyphClass(color: string | null | undefined): 'text-white' | 'text-tile-glyph-dark' {
  return known(color) === 'yellow' ? 'text-tile-glyph-dark' : 'text-white'
}
