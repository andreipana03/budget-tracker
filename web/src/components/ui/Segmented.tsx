import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  /** One or two words, title case. */
  label: string
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<NoInfer<T>>[]
  value: T
  onChange: (value: NoInfer<T>) => void
  /** Names the group for screen readers: "Show", "Period", "Type". */
  'aria-label': string
  /** `toolbar`: the desktop toolbar size (300px wide, 32px tall). */
  variant?: 'default' | 'toolbar'
  className?: string
}

/**
 * Segmented control (design § 6.9): 2–5 segments, selected one on
 * `control-selected` with `aria-pressed`.
 *
 *   <Segmented aria-label="Show" value={kind} onChange={setKind}
 *     options={[{ value: 'all', label: 'All' }, { value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = 'default',
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={rest['aria-label']}
      className={cn(
        'flex h-[34px] rounded-full bg-fill-3 p-0.5',
        variant === 'toolbar' && 'h-8 w-[300px]',
        className,
      )}
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 rounded-full px-2 font-medium whitespace-nowrap text-label transition-[background-color] duration-(--dur-fast)',
              variant === 'toolbar' ? 'text-callout' : 'text-subhead',
              selected && 'bg-control-selected font-semibold shadow-[0_3px_8px_rgba(0,0,0,.12),0_1px_1px_rgba(0,0,0,.04)]',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
