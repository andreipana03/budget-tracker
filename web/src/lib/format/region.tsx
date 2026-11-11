import type { ReactNode } from 'react'

import { RegionContext } from './region-context'

/**
 * The person's number-format region (User.region, e.g. "RO"). Wrap the app once;
 * pass `region` when the signed-in user is known (W-auth: from `useMe().data?.region`).
 * Without it, the browser's region is used. Read it with `useRegion()`.
 */
export function RegionProvider({ region, children }: { region?: string | null; children: ReactNode }) {
  return <RegionContext.Provider value={region || null}>{children}</RegionContext.Provider>
}
