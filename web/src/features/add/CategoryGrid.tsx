import { useRef, type KeyboardEvent } from 'react'

import { CategoryTile } from '@/components/ui/CategoryTile'
import { List } from '@/components/ui/List'
import { cn } from '@/lib/utils'

export interface GridCategory {
  id: string
  name: string
  color: string
  icon: string
}

/**
 * Category picker (design § 6.11): 4 columns of 40px tiles with caption names, a radio
 * group (arrow keys move and select). The selected cell is `tint-soft` with a 2px ring
 * around its tile.
 */
export function CategoryGrid({
  categories,
  value,
  onChange,
  label,
}: {
  categories: readonly GridCategory[]
  value: string | null
  onChange: (id: string) => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focusIndex = Math.max(
    categories.findIndex((c) => c.id === value),
    0,
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 4, ArrowLeft: -1, ArrowUp: -4 }[e.key]
    if (!step || categories.length === 0) return
    e.preventDefault()
    const i = Math.min(Math.max(focusIndex + step, 0), categories.length - 1)
    onChange(categories[i].id)
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[i]?.focus()
  }

  return (
    <List
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="grid grid-cols-4 gap-1.5 px-2 py-3.5 lg:gap-1 lg:py-2.5"
    >
      {categories.map((c, i) => {
        const checked = c.id === value
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(c.id)}
            className={cn(
              'group flex min-w-0 flex-col items-center gap-1.5 rounded-[16px] px-0.5 pt-1.5 pb-2 text-center text-caption-1 leading-[1.2] text-label lg:text-footnote',
              'hover:bg-fill-4',
              checked && 'bg-tint-soft font-semibold text-tint-text hover:bg-tint-soft',
            )}
          >
            <span
              className="rounded-[11px] transition-transform duration-(--dur-press) ease-out group-active:scale-92 lg:rounded-[9px]"
              style={checked ? { boxShadow: '0 0 0 2px var(--sheet-surface), 0 0 0 4px var(--tint)' } : undefined}
            >
              <CategoryTile color={c.color} icon={c.icon} size={40} />
            </span>
            <span className="max-w-full break-words">{c.name}</span>
          </button>
        )
      })}
    </List>
  )
}
