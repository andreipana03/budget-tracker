import { createContext, useContext } from 'react'

import { browserRegion } from './locale'

export const RegionContext = createContext<string | null>(null)

/** The region to pass to format helpers: `formatMoney(m, c, { region: useRegion() })`. */
export function useRegion(): string {
  return useContext(RegionContext) ?? browserRegion()
}
