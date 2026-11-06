import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

import { Icon } from './Icon'

export interface SearchFieldProps extends Omit<ComponentProps<'input'>, 'type' | 'onChange'> {
  value: string
  onValueChange: (value: string) => void
  /** Visually hidden label: "Search transactions". */
  label: string
  className?: string
}

/**
 * Inline search field (design § 6.10, compact Activity): fill-3 capsule with a
 * bold magnifier. Searches as you type; Esc clears.
 *
 *   <SearchField label="Search transactions" value={q} onValueChange={setQ} />
 */
export function SearchField({ value, onValueChange, label, className, placeholder = 'Search', onKeyDown, ...rest }: SearchFieldProps) {
  return (
    <label className={cn('flex h-10 items-center gap-1.5 rounded-full bg-fill-3 px-3 text-label-2', className)}>
      <Icon name="magnifying-glass" className="text-[18px]" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onValueChange('')
          }
          onKeyDown?.(e)
        }}
        className="min-w-0 flex-1 border-0 bg-transparent text-label outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
    </label>
  )
}
