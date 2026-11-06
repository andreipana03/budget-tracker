/**
 * The password policy, mirrored from the API (backend/internal/auth/rules.go) so the
 * checklist ticks off as people type. The API stays the judge: it re-checks on submit.
 */

export type PasswordRuleKey = 'length' | 'uppercase' | 'lowercase' | 'digit' | 'symbol' | 'different'

export interface PasswordRule {
  key: PasswordRuleKey
  /** Sentence case, reads as a requirement: "An uppercase letter". */
  label: string
  met: boolean
}

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

const UPPER = /\p{Lu}/u
const LOWER = /\p{Ll}/u
const DIGIT = /\p{Nd}/u
const SPACE = /\s/u

/** True when the password matches the username, the email or the email's local part (case-insensitive). */
export function sameAsIdentity(password: string, identity: { username?: string; email?: string }): boolean {
  const p = password.trim().toLowerCase()
  if (!p) return false
  const username = identity.username?.trim().toLowerCase()
  if (username && p === username) return true
  const email = identity.email?.trim().toLowerCase()
  if (email) {
    const local = email.split('@')[0]
    if (p === email || (local && p === local)) return true
  }
  return false
}

/**
 * Every rule with whether `password` meets it. Pass `identity` to include the
 * "different from your username and email" rule (sign-up, Settings); leave it out
 * where the page doesn't know them (Reset Password — the API still checks).
 */
export function passwordRules(password: string, identity?: { username?: string; email?: string }): PasswordRule[] {
  const chars = Array.from(password)
  let upper = false
  let lower = false
  let digit = false
  let symbol = false
  for (const c of chars) {
    // Same order as the API: a character counts once, and spaces never count as a symbol.
    if (UPPER.test(c)) upper = true
    else if (LOWER.test(c)) lower = true
    else if (DIGIT.test(c)) digit = true
    else if (!SPACE.test(c)) symbol = true
  }
  const rules: PasswordRule[] = [
    { key: 'length', label: `${PASSWORD_MIN} to ${PASSWORD_MAX} characters`, met: chars.length >= PASSWORD_MIN && chars.length <= PASSWORD_MAX },
    { key: 'uppercase', label: 'An uppercase letter', met: upper },
    { key: 'lowercase', label: 'A lowercase letter', met: lower },
    { key: 'digit', label: 'A number', met: digit },
    { key: 'symbol', label: 'A symbol, like ! or #', met: symbol },
  ]
  if (identity)
    rules.push({
      key: 'different',
      label: 'Different from your username and email',
      met: password.length > 0 && !sameAsIdentity(password, identity),
    })
  return rules
}

/** True when every rule passes. */
export function isPasswordAcceptable(password: string, identity?: { username?: string; email?: string }): boolean {
  return passwordRules(password, identity).every((r) => r.met)
}
