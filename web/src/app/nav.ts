import type { IconName } from '@/components/ui/Icon'

export interface SectionDef {
  id: 'home' | 'activity' | 'budgets' | 'insights' | 'subscriptions'
  label: string
  path: string
  icon: IconName
}

/** The five sections, in ⌘1–⌘5 order (design § 5.2, § 4.6 icon map). */
export const SECTIONS: readonly SectionDef[] = [
  { id: 'home', label: 'Home', path: '/', icon: 'house' },
  { id: 'activity', label: 'Activity', path: '/activity', icon: 'receipt' },
  { id: 'budgets', label: 'Budgets', path: '/budgets', icon: 'chart-donut' },
  { id: 'insights', label: 'Insights', path: '/insights', icon: 'chart-bar' },
  { id: 'subscriptions', label: 'Subscriptions', path: '/subscriptions', icon: 'arrows-clockwise' },
]

/** The section a path belongs to (`/budgets/123` → budgets). Settings is pushed from Home. */
export function sectionForPath(pathname: string): SectionDef['id'] | null {
  if (pathname === '/' || pathname.startsWith('/settings')) return 'home'
  for (const s of SECTIONS) if (s.path !== '/' && (pathname === s.path || pathname.startsWith(`${s.path}/`))) return s.id
  return null
}

/** Compact tab bar: 4 tabs; Subscriptions keeps Insights selected (it's pushed from there). */
export function tabForPath(pathname: string): SectionDef['id'] | null {
  const s = sectionForPath(pathname)
  return s === 'subscriptions' ? 'insights' : s
}

export type TabId = Exclude<SectionDef['id'], 'subscriptions'>

/** The compact tab bar's 4 tabs, left to right (also the order pages swipe in). */
export const TABS = SECTIONS.filter((s): s is SectionDef & { id: TabId } => s.id !== 'subscriptions')

/** Index in TABS of the tab `pathname` belongs to, or -1 (e.g. /status). */
export function tabIndexForPath(pathname: string): number {
  const id = tabForPath(pathname)
  return TABS.findIndex((t) => t.id === id)
}

/** Index in TABS when `pathname` is exactly a tab's root screen (where pages swipe), or -1. */
export function tabRootIndex(pathname: string): number {
  const p = pathname.replace(/\/+$/, '') || '/'
  return TABS.findIndex((t) => t.path === p)
}

/** aria-keyshortcuts for section n (1-based). Chrome reserves ⌘1–9, so ⌥⌘n also works. */
export function sectionShortcut(n: number): string {
  return `Meta+${n} Control+${n} Alt+Meta+${n}`
}
