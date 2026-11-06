import { Popover as BasePopover } from '@base-ui/react/popover'
import type { RefObject } from 'react'

import { Icon } from '@/components/ui/Icon'
import { List } from '@/components/ui/List'
import { Pill } from '@/components/ui/Pill'
import { ResponsiveSheet } from '@/components/ui/ResponsiveSheet'
import { rowClasses } from '@/components/ui/row-classes'
import { InlineError, SkeletonRows } from '@/components/ui/States'
import type { components } from '@/lib/api/schema.gen'
import { formatMoney, formatMonthName, useRegion } from '@/lib/format'
import { useIsRegular } from '@/lib/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

import { useMonths } from './useMonths'

type MonthSummary = components['schemas']['MonthSummary']

export type MonthPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'YYYY-MM' currently shown (undefined = current month). */
  selected: string | undefined
  /** Called with 'YYYY-MM'; the picker closes itself. */
  onSelect: (month: string) => void
  /**
   * Desktop: the element the popover points at. Default: the visible title button
   * (`<Screen titleAction>` renders the toolbar title as an `h1 button`).
   */
  anchor?: Element | RefObject<Element | null> | null
}

/** The visible title button of the current screen (desktop toolbar or compact large title). */
function visibleTitleButton(): Element | null {
  const buttons = Array.from(document.querySelectorAll('h1 button'))
  return buttons.find((b) => b.getClientRects().length > 0) ?? null
}

/** "1.234 lei spent · 2.000 lei budget" (or just the spent part without a budget), whole units. */
function summaryText(m: MonthSummary, currency: string, region: string): string {
  if (m.budgetMinor == null) return `${formatMoney(m.spentMinor, currency, { region, whole: true })} spent`
  return `${formatMoney(m.spentMinor, currency, { region, whole: true })} spent · ${formatMoney(m.budgetMinor, currency, { region, whole: true })} budget`
}

/**
 * Month picker (Home and Budgets titles): a popover anchored to the title on desktop, a
 * sheet on compact. Months from GET /months grouped by year, newest first, each with
 * what was spent (and the budget when one is set); the shown month is checked and the
 * current one marked "This Month".
 *
 *   <MonthPicker open={open} onOpenChange={setOpen} selected={month} onSelect={setMonth} />
 */
export function MonthPicker({ open, onOpenChange, selected, onSelect, anchor }: MonthPickerProps) {
  const isRegular = useIsRegular()
  const choose = (month: string) => {
    onSelect(month)
    onOpenChange(false)
  }

  if (isRegular) {
    return (
      <BasePopover.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
        <BasePopover.Portal>
          <BasePopover.Positioner
            anchor={anchor ?? visibleTitleButton}
            side="bottom"
            align="start"
            sideOffset={8}
            className="z-60 outline-none"
          >
            <BasePopover.Popup
              className={cn(
                'glass glass-strong w-[300px] origin-(--transform-origin) rounded-md p-1.5 text-label outline-none',
                'transition-[scale,opacity] duration-(--dur-fast) ease-out data-starting-style:scale-95 data-starting-style:opacity-0',
                'data-ending-style:scale-95 data-ending-style:opacity-0',
              )}
            >
              <BasePopover.Title className="m-0 px-2.5 pt-1.5 pb-1 text-headline">Choose Month</BasePopover.Title>
              <div className="max-h-[min(440px,60dvh)] overflow-y-auto overscroll-contain">
                {open && <MonthList variant="popover" selected={selected} onChoose={choose} />}
              </div>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    )
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Choose Month" confirmVerb="close">
      {open && <MonthList variant="sheet" selected={selected} onChoose={choose} />}
    </ResponsiveSheet>
  )
}

function MonthList({
  variant,
  selected,
  onChoose,
}: {
  variant: 'sheet' | 'popover'
  selected: string | undefined
  onChoose: (month: string) => void
}) {
  const region = useRegion()
  const months = useMonths()

  if (months.isPending) return <SkeletonRows count={6} className={variant === 'popover' ? 'bg-transparent shadow-none' : undefined} />
  if (months.isError) return <InlineError what="your months" onRetry={() => void months.refetch()} />

  const { current, homeCurrency, items } = months.data
  const shown = selected ?? current
  const years = new Map<string, MonthSummary[]>()
  for (const m of items) {
    const y = m.month.slice(0, 4)
    years.set(y, [...(years.get(y) ?? []), m])
  }
  const yearList = [...years.entries()].sort(([a], [b]) => b.localeCompare(a))

  return (
    <div className="flex flex-col gap-4">
      {yearList.map(([year, ms]) => {
        const rows = ms
          .slice()
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((m) => {
            const isSelected = m.month === shown
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('truncate', isSelected && 'font-semibold')}>{formatMonthName(m.month)}</span>
                    {m.month === current && <Pill>This Month</Pill>}
                  </span>
                  <span className="block text-subhead text-label-2 tabular-nums lg:text-callout">
                    {summaryText(m, homeCurrency, region)}
                  </span>
                </span>
                <span className="grid w-4 flex-none place-items-center">
                  {isSelected && <Icon name="check" className="text-[15px] text-tint-text" />}
                </span>
              </>
            )
            return (
              <button
                key={m.month}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${formatMonthName(m.month)} ${year}${m.month === current ? ', this month' : ''}: ${summaryText(m, homeCurrency, region)}`}
                onClick={() => onChoose(m.month)}
                className={
                  variant === 'sheet'
                    ? cn(rowClasses({ hasLeading: false, interactive: true }), 'py-2 text-body')
                    : 'flex min-h-9 w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-body hover:bg-fill-3'
                }
              >
                {body}
              </button>
            )
          })
        return (
          <section key={year} aria-label={year}>
            <h3
              className={cn(
                'm-0 text-footnote font-semibold tracking-[0.02em] text-label-2 uppercase',
                variant === 'sheet' ? 'px-4 pb-1.5' : 'px-2.5 pb-1',
              )}
            >
              {year}
            </h3>
            {variant === 'sheet' ? <List>{rows}</List> : <div>{rows}</div>}
          </section>
        )
      })}
    </div>
  )
}
