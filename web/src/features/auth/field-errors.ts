import { ApiError } from '@/lib/api/errors'

/**
 * Turns a failed auth/settings call into what the form shows: a message per field
 * (422 `fields`, 409 email_taken / username_taken) and/or one message for the form.
 */
export interface FormErrors<F extends string> {
  fields: Partial<Record<F, string>>
  /** A sentence for the whole form, when no field explains it. */
  form?: string
}

/** Error codes whose meaning is a single field, when the API doesn't list `fields`. */
const CODE_FIELD: Record<string, string> = {
  email_taken: 'email',
  username_taken: 'username',
  name_taken: 'name',
}

/** The app's voice for codes a person can hit on the auth screens (design § 8). */
const CODE_MESSAGE: Record<string, string> = {
  invalid_credentials: 'That email, username or password isn’t right.',
  rate_limited: 'Too many tries. Wait a minute, then try again.',
  google_not_configured: 'Google sign-in isn’t available right now. Use your email and password.',
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return CODE_MESSAGE[error.code] ?? error.message
  return 'Something went wrong. Try again.'
}

/**
 * @param fields   the form's fields, in display order
 * @param aliases  API field name → form field (e.g. { newPassword: 'password' })
 */
export function formErrors<F extends string>(
  error: unknown,
  fields: readonly F[],
  aliases: Partial<Record<string, F>> = {},
): FormErrors<F> {
  const out: FormErrors<F> = { fields: {} }
  if (!(error instanceof ApiError)) {
    out.form = errorMessage(error)
    return out
  }
  const known = new Set<string>(fields)
  const toField = (name: string): F | undefined => {
    const mapped = aliases[name] ?? name
    return known.has(mapped) ? (mapped as F) : undefined
  }

  for (const fe of error.fields) {
    const f = toField(fe.field)
    // First message per field wins: the checklist already shows the rest.
    if (f && !out.fields[f]) out.fields[f] = fe.message
  }

  const codeField = CODE_FIELD[error.code] ? toField(CODE_FIELD[error.code]) : undefined
  if (codeField && !out.fields[codeField]) out.fields[codeField] = error.message

  if (Object.keys(out.fields).length === 0) out.form = errorMessage(error)
  return out
}
