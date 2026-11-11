import { useId, useState, type ComponentProps, type ReactNode } from 'react'

import { Icon } from '@/components/ui/Icon'
import { rowClasses } from '@/components/ui/row-classes'
import { cn } from '@/lib/utils'

import type { PasswordRule } from './password-rules'
import type { UsernameState } from './useUsernameAvailability'

/*
 * Form fields for the signed-out screens and the password sheets in Settings.
 * iOS sign-in style: full-width inputs inside a grouped list row, the label as the
 * placeholder (and as a visually hidden <label> for assistive tech).
 */

const INPUT = 'min-w-0 flex-1 border-0 bg-transparent p-0 text-label outline-none placeholder:text-placeholder'

export type InputRowProps = {
  /** Title case; also the placeholder: "Email or Username". */
  label: string
  /** Trailing control inside the row (e.g. Show / Hide). */
  trailing?: ReactNode
  /** Visible label on the leading edge instead of the placeholder (Settings sheets). */
  showLabel?: boolean
  rowClassName?: string
} & ComponentProps<'input'>

export function InputRow({ label, trailing, showLabel, rowClassName, id, placeholder, className, ...input }: InputRowProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className={cn(rowClasses({ hasLeading: false }), 'cursor-text', rowClassName)}>
      <label htmlFor={inputId} className={showLabel ? 'w-[118px] flex-none text-body lg:w-[110px]' : 'sr-only'}>
        {label}
      </label>
      <input id={inputId} placeholder={placeholder ?? (showLabel ? undefined : label)} className={cn(INPUT, className)} {...input} />
      {trailing}
    </div>
  )
}

/** Password row with a Show / Hide toggle (text, so it's never a mystery glyph). */
export function PasswordRow(props: Omit<InputRowProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false)
  return (
    <InputRow
      {...props}
      type={visible ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
          className="-my-2.5 -mr-2 flex-none rounded-sm px-2 py-2.5 text-subhead text-tint-text lg:text-callout"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      }
    />
  )
}

/**
 * Live password checklist: each rule with a check (met) or an empty ring (not yet),
 * plus the state in text for screen readers — never color alone.
 */
export function PasswordChecklist({ id, rules, className }: { id?: string; rules: PasswordRule[]; className?: string }) {
  return (
    <ul id={id} aria-label="Password needs" className={cn('m-0 grid list-none gap-1 px-4 pt-2.5 lg:px-1', className)}>
      {rules.map((r) => (
        <li key={r.key} className={cn('flex items-center gap-2 text-footnote', r.met ? 'text-label' : 'text-label-2')}>
          {r.met ? (
            <Icon name="check-circle" weight="fill" className="text-[15px] text-positive" />
          ) : (
            <span aria-hidden className="mx-px size-[13px] flex-none rounded-full border-[1.5px] border-current opacity-60" />
          )}
          <span>
            {r.label}
            <span className="sr-only">{r.met ? ': done' : ': not yet'}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Footer under the username field: "Available" (check), "Checking…", or why not.
 * A server field error (`error`) wins.
 */
export function UsernameStatus({ id, state, error }: { id?: string; state: UsernameState; error?: string }) {
  const base = 'm-0 flex min-h-[26px] items-center gap-1.5 px-4 pt-2 text-footnote lg:px-1'
  const message = error ?? (state.status === 'unavailable' ? state.message : undefined)
  if (message)
    return (
      <p id={id} role="alert" className={cn(base, 'items-start text-negative')}>
        <Icon name="warning-circle" weight="fill" className="mt-px text-[1.1em]" />
        <span>{message}</span>
      </p>
    )
  return (
    <p id={id} aria-live="polite" className={cn(base, 'text-label-2')}>
      {state.status === 'available' && (
        <>
          <Icon name="check-circle" weight="fill" className="text-[1.1em] text-positive" />
          <span className="text-label">Available</span>
        </>
      )}
      {state.status === 'checking' && <span>Checking…</span>}
      {state.status === 'error' && <span>Couldn’t check this username. It’s checked again when you continue.</span>}
      {state.status === 'idle' && <span>3–30 letters, numbers, dots, dashes or underscores.</span>}
    </p>
  )
}
