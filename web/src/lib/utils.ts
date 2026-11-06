import { createCn } from 'cn/config'

/**
 * Class-name joining + Tailwind conflict resolution, taught the design system's
 * theme (src/styles/tailwind-theme.css). Without this, `cn('text-body text-label-2')`
 * drops `text-body`, because the default config reads unknown `text-*` names as
 * colors. Keep these lists in sync with the theme when it gains a token.
 */
const TEXT_STYLES = [
  'display',
  'large-title',
  'title-1',
  'title-2',
  'title-3',
  'headline',
  'body',
  'callout',
  'subhead',
  'footnote',
  'caption-1',
  'caption-2',
]

const COLORS = [
  'bg',
  'surface',
  'surface-2',
  'sheet',
  'sheet-surface',
  'label',
  'label-2',
  'label-3',
  'label-4',
  'placeholder',
  'separator',
  'separator-opaque',
  'fill-1',
  'fill-2',
  'fill-3',
  'fill-4',
  'control-selected',
  'tint',
  'tint-text',
  'tint-soft',
  'on-tint',
  'positive',
  'negative',
  'negative-fill',
  'chart-neutral',
  'chart-track',
  'marker',
  'dim',
  'glass-selected',
  'white',
  'transparent',
  'current',
  'tile-glyph-dark',
  ...['groceries', 'eating', 'housing', 'transport', 'fun', 'shopping', 'education', 'other', 'income'].flatMap(
    (c) => [`cat-${c}`, `tile-${c}`],
  ),
]

export const cn = createCn({
  extend: {
    theme: {
      text: TEXT_STYLES,
      color: COLORS,
      radius: ['xs', 'sm', 'md', 'lg', 'xl', 'tile', 'full'],
      shadow: ['card', 'glass'],
      font: ['sans', 'rounded', 'mono'],
      ease: ['out', 'in-out', 'sheet'],
    },
  },
})
