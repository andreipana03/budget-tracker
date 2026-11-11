import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

export interface SectionAction {
  /** Title case: "See All", "Edit". */
  label: string
  to?: string
  onClick?: () => void
}

/**
 * Section header (design § 6.4): `title-3` bold (desktop `title-2`) with an
 * optional trailing plain action.
 *
 *   <SectionHeader title="Budgets" id="h-budgets" action={{ label: 'See All', to: '/budgets' }} />
 */
export function SectionHeader({
  title,
  id,
  action,
  as: Heading = 'h2',
  className,
}: {
  title: ReactNode
  /** Put the id on the heading and `aria-labelledby` it from the <section>. */
  id?: string
  action?: SectionAction
  as?: 'h2' | 'h3'
  className?: string
}) {
  const linkClass = 'text-subhead text-tint-text -my-2.5 py-2.5 pl-3 lg:text-body'
  return (
    <div className={cn('flex items-baseline justify-between gap-3 px-1 pb-2 lg:px-0.5 lg:pb-2.5', className)}>
      <Heading id={id} className="m-0 text-title-3 font-bold lg:text-title-2">
        {title}
      </Heading>
      {action &&
        (action.to ? (
          <Link to={action.to} className={linkClass}>
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={linkClass}>
            {action.label}
          </button>
        ))}
    </div>
  )
}

/** Explains the section above (sentence case). Never repeats the header. */
export function SectionFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('m-0 px-4 pt-2 text-footnote text-label-2 lg:px-0.5', className)}>{children}</p>
}

/**
 * Header + content + optional footer, labelled for landmarks.
 *
 *   <Section title="Upcoming" action={{ label: 'See All', to: '/subscriptions' }}>
 *     <List>…</List>
 *   </Section>
 */
export function Section({
  title,
  action,
  footer,
  children,
  className,
  id,
}: {
  title?: ReactNode
  action?: SectionAction
  footer?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  const headingId = id ?? (typeof title === 'string' ? `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined)
  return (
    <section className={className} aria-labelledby={title ? headingId : undefined}>
      {title && <SectionHeader title={title} id={headingId} action={action} />}
      {children}
      {footer && <SectionFooter>{footer}</SectionFooter>}
    </section>
  )
}
