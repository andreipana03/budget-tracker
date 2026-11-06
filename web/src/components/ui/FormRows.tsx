import { Menu as BaseMenu } from '@base-ui/react/menu'
import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

import { RowAccessory } from './List'
import { rowClasses } from './row-classes'
import { MenuPopup, MenuRadioGroup, MenuRadioItem } from './Menu'

/* Form rows for grouped lists (Add sheet details, Settings). Put them in a <List>.
   Label on the leading edge (`text-body`), value right-aligned. */

const LABEL = 'flex-none text-body'
const VALUE = 'flex min-w-0 items-center gap-1.5 truncate text-body text-label-2'

/**
 * Text field row with a right-aligned input (16px+ so iOS never zooms).
 *
 *   <TextFieldRow label="Note" placeholder="Merchant or note" value={note} onChange={e => setNote(e.target.value)} />
 */
export function TextFieldRow({
  label,
  className,
  inputClassName,
  ...input
}: { label: string; inputClassName?: string } & ComponentProps<'input'>) {
  return (
    <label className={cn(rowClasses({ hasLeading: false }), 'cursor-text', className)}>
      <span className={LABEL}>{label}</span>
      <input
        autoComplete="off"
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent text-right text-label outline-none placeholder:text-placeholder',
          inputClassName,
        )}
        {...input}
      />
    </label>
  )
}

/**
 * Label + value row with a disclosure chevron (pushes / opens a picker) or a
 * pop-up glyph (opens a menu). Renders a Link with `to`, else a button.
 *
 *   <DetailRow label="Date" value="Today" onClick={openDatePicker} />
 *   <DetailRow label="Category" value="Fun" valueLeading={<CategoryTile size={20} … />} accessory="none" />
 */
export function DetailRow({
  label,
  value,
  valueLeading,
  accessory = 'disclosure',
  to,
  onClick,
  className,
  'aria-label': ariaLabel,
}: {
  label: string
  value?: ReactNode
  /** e.g. a 20px CategoryTile before the value. */
  valueLeading?: ReactNode
  accessory?: 'disclosure' | 'popup' | 'none'
  to?: string
  onClick?: () => void
  className?: string
  'aria-label'?: string
}) {
  const interactive = Boolean(to || onClick)
  const classes = cn(rowClasses({ hasLeading: false, interactive }), className)
  const body = (
    <>
      <span className={LABEL}>{label}</span>
      <span className="min-w-0 flex-1" />
      <span className={VALUE}>
        {valueLeading}
        {value}
      </span>
      {accessory !== 'none' && <RowAccessory kind={accessory} />}
    </>
  )
  if (to)
    return (
      <Link to={to} className={classes} aria-label={ariaLabel}>
        {body}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={classes} aria-label={ariaLabel}>
        {body}
      </button>
    )
  return <div className={classes}>{body}</div>
}

/**
 * iOS-style switch (tint when on). Base UI Switch: role="switch", keyboard, form value.
 *
 *   <Switch checked={on} onCheckedChange={setOn} aria-label="Fixed" />
 */
export function Switch({ className, ...rest }: ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        'relative inline-flex h-[31px] w-[51px] flex-none items-center rounded-full bg-fill-1 p-0.5 transition-colors duration-(--dur-fast)',
        'data-checked:bg-tint data-disabled:opacity-40 lg:h-[22px] lg:w-[38px]',
        className,
      )}
      {...rest}
    >
      <BaseSwitch.Thumb
        className={cn(
          'block size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,.15),0_1px_1px_rgba(0,0,0,.16)]',
          'transition-transform duration-(--dur-fast) ease-out data-checked:translate-x-5 lg:size-[18px] lg:data-checked:translate-x-4',
        )}
      />
    </BaseSwitch.Root>
  )
}

/**
 * Row with a trailing switch. The whole row is the label.
 *
 *   <SwitchRow label="This month only" checked={single} onCheckedChange={setSingle} />
 */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: string
  /** Optional second line (footnote, label-2). */
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn(rowClasses({ hasLeading: false }), className)}>
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-body">
          {label}
        </label>
        {description && <span className="block text-footnote text-label-2">{description}</span>}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v)} disabled={disabled} />
    </div>
  )
}

export interface SelectOption<T extends string> {
  value: T
  label: string
}

/**
 * Pop-up row: label + current value + ⌃⌄ glyph; opens a glass menu of radio items.
 *
 *   <SelectRow label="Repeat" value={repeat} onValueChange={setRepeat}
 *     options={[{ value: 'never', label: 'Never' }, { value: 'monthly', label: 'Monthly' }]} />
 */
export function SelectRow<T extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled,
  className,
}: {
  label: string
  value: T
  options: readonly SelectOption<NoInfer<T>>[]
  onValueChange: (value: NoInfer<T>) => void
  disabled?: boolean
  className?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        disabled={disabled}
        className={cn(rowClasses({ hasLeading: false, interactive: true }), 'data-popup-open:bg-fill-4', className)}
        aria-label={`${label}: ${current?.label ?? ''}`}
      >
        <span className={LABEL}>{label}</span>
        <span className="min-w-0 flex-1" />
        <span className={VALUE}>{current?.label}</span>
        <RowAccessory kind="popup" />
      </BaseMenu.Trigger>
      <MenuPopup align="end">
        <MenuRadioGroup value={value} onValueChange={(v) => onValueChange(v as T)}>
          {options.map((o) => (
            <MenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </BaseMenu.Root>
  )
}
