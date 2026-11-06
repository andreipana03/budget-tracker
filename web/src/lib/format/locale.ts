/**
 * Region → number-format locale. The UI language is always English; numbers and
 * currencies follow the person's *region* (design § 1, § 6.7), like iOS
 * Settings › Language & Region: region "RO" → locale "ro-RO" → "1.234,29 lei".
 */

const FALLBACK_REGION = 'RO'

/** The browser's region ("en-US" → "US"), or "RO" when it can't be read. */
export function browserRegion(): string {
  try {
    const tag = typeof navigator !== 'undefined' ? navigator.language : undefined
    if (tag) {
      const region = new Intl.Locale(tag).maximize().region
      if (region) return region
    }
  } catch {
    // fall through
  }
  return FALLBACK_REGION
}

const localeCache = new Map<string, string>()

/** "RO" → "ro-RO", "DE" → "de-DE", "US" → "en-US". Unknown or empty → the browser's region. */
export function localeForRegion(region?: string | null): string {
  const key = (region || browserRegion()).toUpperCase()
  const cached = localeCache.get(key)
  if (cached) return cached
  let locale = 'ro-RO'
  try {
    const language = new Intl.Locale(`und-${key}`).maximize().language
    locale = `${language}-${key}`
    // Throws on anything Intl can't use.
    new Intl.NumberFormat(locale)
  } catch {
    locale = 'ro-RO'
  }
  localeCache.set(key, locale)
  return locale
}

/** Intl output uses no-break spaces (U+00A0, U+202F); we return plain spaces so strings are predictable. */
export function normalizeSpaces(s: string): string {
  return s.replace(/[  ]/g, ' ')
}
