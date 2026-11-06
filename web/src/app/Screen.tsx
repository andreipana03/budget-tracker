import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'

import { GlassButton } from '@/components/ui/GlassButton'
import { Icon, type IconName } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

import { useAddSheet } from './add-sheet'
import { useShell } from './shell-context'
import { SHORTCUTS } from './shortcuts'

export interface ScreenProps {
  /** Large title (compact) and toolbar title (desktop): "Budgets", "November". Title case. */
  title: string
  /** Compact only: small uppercase line above the large title ("WEDNESDAY, 18 NOVEMBER" — pass any case). */
  eyebrow?: string
  /** Makes the title a button with a ⌄ caret (Home month picker). `label` is its accessible name. */
  titleAction?: { onClick: () => void; label: string }
  /** Anything to put right after the title on both layouts. */
  titleAccessory?: ReactNode
  /** Desktop: `label-2` text after the toolbar title ("2026", "November"). */
  context?: string
  /** Compact: trailing floating glass buttons in the top bar (use <GlassButton>). */
  topBarActions?: ReactNode
  /** Desktop: toolbar controls between the title and search (≤ 3 groups: <ToolbarGroup>, <Segmented variant="toolbar">). */
  toolbarControls?: ReactNode
  /** Pushed screen: leading Back glass circle (compact) / back button (desktop). Label is the action: "Back to Insights". */
  back?: { to: string; label: string }
  /** Hide the desktop search capsule and "Add Transaction" (e.g. Settings). */
  hideToolbarActions?: boolean
  children: ReactNode
  className?: string
}

/**
 * The layout every screen uses. Renders the compact top bar (floating glass buttons,
 * inline title fading in after 40px of scroll), the compact large title with optional
 * eyebrow, and the desktop sticky toolbar (title + context, controls, search capsule
 * with ⌘F that searches Activity, prominent "Add Transaction").
 *
 * @example Home
 *   <Screen title="November" eyebrow={formatEyebrow(today)} context="2026"
 *     titleAction={{ onClick: openMonthPicker, label: 'November, choose month' }}
 *     topBarActions={<GlassButton icon="user-circle" label="Profile and Settings" to="/settings" />}>
 *     …
 *   </Screen>
 *
 * @example Budgets
 *   <Screen title="Budgets" eyebrow="November" context="November"
 *     topBarActions={<GlassButton text="Edit" onClick={edit} />}
 *     toolbarControls={<ToolbarGroup><ToolbarButton icon="pencil-simple" onClick={edit}>Edit Budgets</ToolbarButton></ToolbarGroup>}>
 *
 * @example Insights (segmented control in the desktop toolbar, inline on compact)
 *   <Screen title="Insights" topBarActions={<GlassButton icon="export" label="Share Insights" onClick={share} />}
 *     toolbarControls={<Segmented variant="toolbar" aria-label="Period" … />}>
 *
 * @example Pushed screen
 *   <Screen title="Subscriptions" back={{ to: '/insights', label: 'Back to Insights' }}>
 *
 * Content layout is the screen's job: wrap sections in `flex flex-col gap-7 lg:gap-5`
 * (28px compact / 20px regular between sections) and use `lg:grid` for dashboards.
 */
export function Screen({
  title,
  eyebrow,
  titleAction,
  titleAccessory,
  context,
  topBarActions,
  toolbarControls,
  back,
  hideToolbarActions,
  children,
  className,
}: ScreenProps) {
  const shell = useShell()
  const scrolled = useScrolledPast(40)

  useEffect(() => {
    document.title = `${title} — Budget Tracker`
  }, [title])

  const titleContent = titleAction ? (
    <button type="button" onClick={titleAction.onClick} aria-label={titleAction.label} className="inline-flex items-center gap-1.5 font-bold">
      {title}
      <Icon name="caret-down" className="mt-1 text-[0.55em] text-tint-text" />
    </button>
  ) : (
    title
  )

  return (
    <>
      {/* Compact top bar: floating glass buttons, no bar background */}
      <div className="app-chrome pointer-events-none fixed inset-x-0 top-0 z-20 flex h-[calc(var(--safe-top)+52px)] items-center gap-2 px-4 pt-(--safe-top) lg:hidden [&>*]:pointer-events-auto">
        {back && <GlassButton icon="caret-left" label={back.label} to={back.to} />}
        <div className="pointer-events-none! flex-1" />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none! absolute bottom-3.5 left-1/2 max-w-[55%] -translate-x-1/2 truncate text-headline transition-opacity duration-(--dur-fast)',
            scrolled ? 'opacity-100' : 'opacity-0',
          )}
        >
          {title}
        </span>
        {topBarActions}
      </div>

      {/* Regular toolbar: sticky, no background (the scroll-edge band blurs beneath it) */}
      <div className="sticky top-0 z-16 mx-auto hidden h-[76px] max-w-[calc(var(--content-max)+64px)] items-center gap-2.5 px-8 lg:flex">
        {shell?.sidebarHidden && (
          <ToolbarIconButton icon="sidebar-simple" label="Show Sidebar" onClick={shell.toggleSidebar} keys={SHORTCUTS.sidebar.keys} />
        )}
        {back && <ToolbarIconButton icon="caret-left" label={back.label} to={back.to} />}
        <h1 className="m-0 flex min-w-0 items-baseline gap-2.5 text-large-title font-bold">
          <span className="truncate">{titleContent}</span>
          {context && <small className="text-title-3 font-normal tracking-normal whitespace-nowrap text-label-2">{context}</small>}
          {titleAccessory}
        </h1>
        <div className="flex-1" />
        {toolbarControls}
        {!hideToolbarActions && (
          <>
            <ToolbarSearch />
            <ToolbarAddButton />
          </>
        )}
      </div>

      <div className={cn('mx-auto max-w-[720px] px-4 lg:max-w-(--content-max) lg:px-8', className)}>
        {/* Compact large title */}
        <header className="pt-0.5 pb-3.5 lg:hidden">
          {eyebrow && (
            <p className="m-0 mb-0.5 text-footnote font-semibold tracking-[0.02em] text-label-2 uppercase">{eyebrow}</p>
          )}
          <h1 className="m-0 flex items-center gap-1.5 text-large-title font-bold">
            {titleContent}
            {titleAccessory}
          </h1>
        </header>
        {children}
      </div>
    </>
  )
}

/** True once the app scroller is scrolled past `px` (drives the inline title). */
function useScrolledPast(px: number): boolean {
  const shell = useShell()
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = shell?.scrollerRef.current
    if (!el) return
    const update = () => setPast(el.scrollTop > px)
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [shell, px])
  return past
}

/**
 * Desktop toolbar search capsule (240px, ⌘F). Typing on Activity filters live
 * (`?q=`); elsewhere Return opens Activity with the query.
 */
function ToolbarSearch() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const onActivity = location.pathname === '/activity'
  const [draft, setDraft] = useState('')
  const value = onActivity ? (params.get('q') ?? '') : draft

  const update = (q: string) => {
    if (onActivity) {
      const next = new URLSearchParams(params)
      if (q) next.set('q', q)
      else next.delete('q')
      setParams(next, { replace: true })
    } else setDraft(q)
  }

  return (
    <form
      role="search"
      className="glass flex h-9 w-60 flex-none items-center gap-2 rounded-full px-3.5 text-label-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!onActivity) {
          navigate(value ? `/activity?q=${encodeURIComponent(value)}` : '/activity')
          setDraft('')
        }
      }}
    >
      <Icon name="magnifying-glass" className="text-[16px]" />
      <label htmlFor="toolbar-search" className="sr-only">
        Search transactions
      </label>
      <input
        id="toolbar-search"
        data-search-field="toolbar"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Search"
        aria-keyshortcuts={SHORTCUTS.search.keys}
        value={value}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (value) update('')
            else e.currentTarget.blur()
          }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent text-body text-label outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="rounded-[5px] bg-fill-3 px-1.5 py-px font-sans text-footnote text-label-2">{SHORTCUTS.search.hint}</kbd>
    </form>
  )
}

/** The one prominent action on desktop: "Add Transaction" (⌘N). */
function ToolbarAddButton() {
  const addSheet = useAddSheet()
  return (
    <button
      type="button"
      onClick={() => addSheet.open()}
      aria-keyshortcuts={SHORTCUTS.add.keys}
      title={`Add Transaction (${SHORTCUTS.add.hint})`}
      className="glass glass-prominent inline-flex h-9 flex-none items-center gap-1.5 rounded-full pr-4 pl-3 text-body font-semibold transition-transform duration-(--dur-press) ease-out active:scale-97"
    >
      <Icon name="plus" className="text-[17px]" />
      Add Transaction
    </button>
  )
}

function ToolbarIconButton({
  icon,
  label,
  onClick,
  to,
  keys,
}: {
  icon: IconName
  label: string
  onClick?: () => void
  to?: string
  keys?: string
}) {
  const cls = 'glass grid size-9 flex-none place-items-center rounded-full text-[17px] text-label hover:brightness-97'
  if (to)
    return (
      <Link to={to} aria-label={label} title={label} className={cls}>
        <Icon name={icon} variant="toolbar" />
      </Link>
    )
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-keyshortcuts={keys} className={cls}>
      <Icon name={icon} variant="toolbar" />
    </button>
  )
}

/**
 * A glass capsule group in the desktop toolbar (≤ 3 per toolbar).
 *
 *   <ToolbarGroup><ToolbarButton icon="pencil-simple" onClick={edit}>Edit Budgets</ToolbarButton></ToolbarGroup>
 */
export function ToolbarGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div role="group" aria-label={label} className="glass flex h-9 flex-none items-center gap-0.5 rounded-full px-1">
      {children}
    </div>
  )
}

/** Text (+ optional icon) button inside a ToolbarGroup. Icon-only buttons need `label`. */
export function ToolbarButton({
  icon,
  children,
  label,
  onClick,
  pressed,
}: {
  icon?: IconName
  children?: ReactNode
  label?: string
  onClick?: () => void
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={children ? undefined : label}
      aria-pressed={pressed}
      title={children ? undefined : label}
      className="inline-flex h-7 min-w-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-body text-label hover:bg-fill-4 aria-pressed:bg-glass-selected"
    >
      {icon && <Icon name={icon} variant="toolbar" />}
      {children}
    </button>
  )
}
