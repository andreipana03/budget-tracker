import { cn } from '@/lib/utils'

/** The row chrome every row type shares. `size`: `lg` = two-line row with a 40px tile. */
export function rowClasses({
  size = 'single',
  hasLeading = true,
  interactive = false,
  selected = false,
}: {
  size?: 'single' | 'double'
  hasLeading?: boolean
  interactive?: boolean
  selected?: boolean
}) {
  return cn(
    'ui-row relative flex w-full min-h-11 items-center gap-3 px-4 py-[11px] text-left lg:min-h-9 lg:px-[14px] lg:py-[9px]',
    size === 'double' && 'ui-row--lg min-h-[60px] py-2.5 lg:min-h-[52px]',
    !hasLeading && 'ui-row--plain',
    interactive && 'cursor-default active:bg-fill-4 hover:bg-fill-4',
    selected && 'bg-tint-soft hover:bg-tint-soft',
  )
}
