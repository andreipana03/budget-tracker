import { useEffect, type ReactNode } from 'react'

import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

/**
 * Frame for the signed-out screens (Sign In, Create Account, Forgot / Reset Password,
 * Verify Email). Compact: content straight on `bg`, inset grouped fields. Regular:
 * the same content in a centered 400px card, no sidebar.
 *
 * Inside the desktop card the lists sit on `surface-2` wells (the card is `surface`):
 * pass AUTH_LIST to every <List>.
 */
export function AuthLayout({
  title,
  subtitle,
  documentTitle,
  children,
}: {
  /** Title case: "Budget Tracker", "Create Account". */
  title: string
  /** One sentence under the title. */
  subtitle?: ReactNode
  /** Browser tab title; defaults to `title`. */
  documentTitle?: string
  children: ReactNode
}) {
  useEffect(() => {
    const t = documentTitle ?? title
    document.title = t === 'Budget Tracker' ? t : `${t} — Budget Tracker`
  }, [documentTitle, title])

  return (
    <main className="min-h-dvh bg-bg px-4 pt-[calc(var(--safe-top)+44px)] pb-[calc(var(--safe-bottom)+32px)] lg:flex lg:items-center lg:justify-center lg:py-12">
      <div className="mx-auto w-full max-w-[400px] lg:mx-0 lg:rounded-md lg:bg-surface lg:px-8 lg:pt-9 lg:pb-8 lg:shadow-card">
        <header className="mb-7 flex flex-col items-center text-center lg:mb-6">
          <img
            src="/favicon.svg"
            alt=""
            width={72}
            height={72}
            className="size-[72px] drop-shadow-[0_2px_6px_rgba(0,0,0,.12)] lg:size-14"
          />
          <h1 className="m-0 mt-4 text-large-title font-bold lg:mt-3.5 lg:text-title-1">{title}</h1>
          {subtitle && <p className="m-0 mt-1.5 max-w-[340px] text-subhead text-label-2 lg:text-callout">{subtitle}</p>}
        </header>
        {children}
      </div>
    </main>
  )
}

/** Lists inside the desktop card: `surface-2` wells instead of a second card. */
export const AUTH_LIST = 'lg:bg-surface-2 lg:shadow-none'

/** Footer under a list: an error (with icon, `role="alert"`) or a plain note. */
export function FieldNote({
  id,
  tone = 'note',
  children,
  className,
}: {
  id?: string
  tone?: 'note' | 'error'
  children: ReactNode
  className?: string
}) {
  if (tone === 'error')
    return (
      <p id={id} role="alert" className={cn('m-0 flex gap-1.5 px-4 pt-2 text-footnote text-negative lg:px-1', className)}>
        <Icon name="warning-circle" weight="fill" className="mt-px text-[1.1em]" />
        <span>{children}</span>
      </p>
    )
  return (
    <p id={id} className={cn('m-0 px-4 pt-2 text-footnote text-label-2 lg:px-1', className)}>
      {children}
    </p>
  )
}

/** "or" between the password form and Google. */
export function OrSeparator() {
  return (
    <div className="my-5 flex items-center gap-3 text-footnote text-label-2" role="separator" aria-label="or">
      <span aria-hidden className="h-px flex-1 scale-y-50 bg-separator" />
      <span aria-hidden>or</span>
      <span aria-hidden className="h-px flex-1 scale-y-50 bg-separator" />
    </div>
  )
}
