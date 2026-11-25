import type { ComponentType } from 'react'

import type { TabId } from './nav'

/**
 * The four tab screens as lazily loaded chunks. The router loads them for their routes;
 * the page swipe (page-swipe.ts) renders a neighbour live while the finger drags, so it
 * preloads them and reads the loaded component synchronously (no Suspense flash).
 */
const loaders: Record<TabId, () => Promise<ComponentType>> = {
  home: async () => (await import('@/features/home/HomePage')).HomePage,
  activity: async () => (await import('@/features/activity/ActivityPage')).ActivityPage,
  budgets: async () => (await import('@/features/budgets/BudgetsPage')).BudgetsPage,
  insights: async () => (await import('@/features/insights/InsightsPage')).InsightsPage,
}

const loaded = new Map<TabId, ComponentType>()

export async function loadTabPage(id: TabId): Promise<ComponentType> {
  const Component = await loaders[id]()
  loaded.set(id, Component)
  return Component
}

/** The tab's component if its chunk has already loaded. */
export function loadedTabPage(id: TabId): ComponentType | undefined {
  return loaded.get(id)
}
