/**
 * The live hint under the amount (design § 6.11 — "the app's main moment of delight"):
 *
 *   "329,10 lei left in Groceries after this"
 *   "This puts Eating Out 52,00 lei over"        (red)
 *
 * Built from the current month's GET /budgets line for the chosen category. Amounts in
 * another currency are converted first (GET /fx/quote) and the result is marked "≈".
 */
import { formatMoney } from '@/lib/format'

export interface HintLine {
  category: { name: string }
  limitMinor: number | null
  spentMinor: number
}

export interface Hint {
  text: string
  over: boolean
}

export function buildHint({
  line,
  amountHomeMinor,
  alreadyCountedMinor = 0,
  homeCurrency,
  approx = false,
  region,
}: {
  line: HintLine | undefined
  /** The amount being typed, in the home currency (0 while empty). */
  amountHomeMinor: number
  /** When editing: what this transaction already adds to `spentMinor`. */
  alreadyCountedMinor?: number
  homeCurrency: string
  /** The amount was converted from another currency. */
  approx?: boolean
  region?: string | null
}): Hint | null {
  if (!line || line.limitMinor == null) return null
  const spent = line.spentMinor - alreadyCountedMinor
  const left = line.limitMinor - spent - amountHomeMinor
  const name = line.category.name
  if (left < 0) {
    return { text: `This puts ${name} ${formatMoney(-left, homeCurrency, { region, approx })} over`, over: true }
  }
  const leftText = formatMoney(left, homeCurrency, { region, approx })
  return { text: amountHomeMinor > 0 ? `${leftText} left in ${name} after this` : `${leftText} left in ${name}`, over: false }
}
