import type { IconName } from '@/components/ui/icons'
import type { Account } from '@/lib/api/queries'

/**
 * The glyph that stands for an account wherever balances are listed (design § 4.6:
 * Accounts `CreditCard` / `Money` / `GlobeHemisphereWest`): cash → Money, an account
 * in another currency → Globe, anything else → CreditCard. Shared by the desktop
 * sidebar and Home's compact Accounts section so both show the same icon.
 */
export function accountIcon(a: Pick<Account, 'type' | 'currency'>, homeCurrency: string): IconName {
  if (a.type === 'cash') return 'money'
  if (a.currency !== homeCurrency) return 'globe-hemisphere-west'
  return 'credit-card'
}
