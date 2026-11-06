import { useLocation, useNavigate } from 'react-router'

import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

import { useAddSheet } from './add-sheet'
import { SECTIONS, tabForPath } from './nav'
import { SHORTCUTS } from './shortcuts'

const TABS = SECTIONS.filter((s) => s.id !== 'subscriptions')

/**
 * Compact/medium navigation (design § 6.1, § 11 snippet): a floating glass tab
 * bar with 4 tabs and a separate 62px glass-prominent Add button. Hidden ≥ 1024.
 * Tab labels and glyphs are fixed px on purpose (they don't grow with Dynamic Type).
 */
export function TabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const addSheet = useAddSheet()
  const current = tabForPath(pathname)

  return (
    <div
      className="app-chrome fixed inset-x-4 z-30 flex items-center gap-2.5 md:right-auto md:left-1/2 md:w-[520px] md:-translate-x-1/2 lg:hidden"
      style={{ bottom: 'max(12px, calc(var(--safe-bottom) - 12px))' }}
    >
      <nav role="tablist" aria-label="Sections" className="glass flex h-[62px] flex-1 rounded-full p-1">
        {TABS.map((t) => {
          const selected = t.id === current
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => navigate(t.path)}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-px rounded-full text-[11px] leading-[13px] font-semibold tracking-[0.01em] text-label',
                'transition-[background-color,color] duration-(--dur-fast)',
                selected && 'bg-glass-selected text-tint',
              )}
            >
              <Icon name={t.icon} variant="tab" />
              {t.label}
            </button>
          )
        })}
      </nav>
      <button
        type="button"
        aria-label="Add Expense"
        aria-keyshortcuts={SHORTCUTS.add.keys}
        onClick={() => addSheet.open()}
        className="glass glass-prominent grid size-[62px] flex-none place-items-center rounded-full text-[28px] transition-transform duration-(--dur-press) ease-out active:scale-94"
      >
        <Icon name="plus" />
      </button>
    </div>
  )
}
