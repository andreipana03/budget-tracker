import { useId, type ComponentProps, type ReactNode } from 'react'

import { Icon, type IconName } from '@/components/ui/Icon'
import { rowClasses } from '@/components/ui/row-classes'
import { cn } from '@/lib/utils'

/* Small building blocks shared by the Settings screens and sheets. */

/** A radio row in a picker list: title (+ subtitle) and a trailing check when selected. */
export function OptionRow({
  title,
  subtitle,
  trailing,
  selected,
  onSelect,
  disabled,
}: {
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  selected: boolean
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(rowClasses({ hasLeading: false, interactive: true }), 'disabled:opacity-40')}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{title}</span>
        {subtitle && <span className="block truncate text-subhead text-label-2 lg:text-callout">{subtitle}</span>}
      </span>
      {trailing && <span className="flex-none text-body text-label-2 tabular-nums">{trailing}</span>}
      <span className="grid w-5 flex-none place-items-center">
        {selected && <Icon name="check" className="text-[17px] text-tint-text" />}
      </span>
    </button>
  )
}

/** A full-row action in a grouped list: "Sign Out", "Delete Account", "Unarchive Account". */
export function ActionRow({
  children,
  destructive,
  onClick,
  disabled,
}: {
  children: ReactNode
  destructive?: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        rowClasses({ hasLeading: false, interactive: true }),
        'text-body disabled:opacity-40',
        destructive ? 'text-negative' : 'text-tint-text',
      )}
    >
      {children}
    </button>
  )
}

/** Label + native date input, right-aligned like the other form rows. */
export function DateRow({ label, ...input }: { label: string } & Omit<ComponentProps<'input'>, 'type'>) {
  const id = useId()
  return (
    <div className={rowClasses({ hasLeading: false })}>
      <label htmlFor={id} className="flex-none text-body">
        {label}
      </label>
      <span className="min-w-0 flex-1" />
      <input
        id={id}
        type="date"
        className="min-w-0 border-0 bg-transparent p-0 text-right text-label-2 outline-none [&::-webkit-date-and-time-value]:text-right"
        {...input}
      />
    </div>
  )
}

/** Neutral 30px tile for account types (accounts have no category color). */
export function AccountTile({ icon, size = 30 }: { icon: IconName; size?: 30 | 40 }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid flex-none place-items-center bg-fill-3 text-label-2',
        size === 30 ? 'size-[30px] rounded-tile text-[18px] lg:size-7 lg:text-[16px]' : 'size-10 rounded-[11px] text-[22px] lg:size-9 lg:rounded-[9px] lg:text-[20px]',
      )}
    >
      <Icon name={icon} />
    </span>
  )
}

/** Error under a list (sentence, icon, announced). */
export function ListError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} role="alert" className="m-0 flex gap-1.5 px-4 pt-2 text-footnote text-negative lg:px-0.5">
      <Icon name="warning-circle" weight="fill" className="mt-px text-[1.1em]" />
      <span>{children}</span>
    </p>
  )
}

/** Vertical stack of groups inside a section (iOS: ~24px between groups). */
export function Groups({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-6 lg:gap-5', className)}>{children}</div>
}

/**
 * Pop-up row backed by a native <select>: for long lists inside a sheet (iOS shows its
 * own wheel picker; nothing can overflow the screen, and no second sheet is needed).
 */
export function NativeSelectRow({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className={cn(rowClasses({ hasLeading: false, interactive: !disabled }), 'relative')}>
      <label htmlFor={id} className="flex-none text-body">
        {label}
      </label>
      <span className="min-w-0 flex-1" />
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 appearance-none truncate border-0 bg-transparent p-0 text-right text-label-2 outline-none disabled:opacity-60 [text-align-last:right]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {!disabled && <Icon name="caret-up-down" className="-ml-1 flex-none text-[14px] text-label-3" />}
    </div>
  )
}
