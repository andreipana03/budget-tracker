import type { components } from './schema.gen'

export type ApiErrorBody = components['schemas']['Error']
export type ApiFieldError = components['schemas']['FieldError']

/**
 * A failed API call, carrying the API's stable `code` and its readable `message`
 * (already in the app's voice — screens can show it as is).
 *
 *   if (error instanceof ApiError && error.code === 'version_conflict') …
 *   <InlineError message={error.message} onRetry={refetch} />
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: ApiFieldError[]

  constructor(status: number, code: string, message: string, fields: ApiFieldError[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }

  /** The message for one request field ("password"), if the API flagged it. */
  fieldMessage(field: string): string | undefined {
    return this.fields.find((f) => f.field === field)?.message
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: 'Your session has ended. Sign in again.',
  403: 'You don’t have access to this.',
  404: 'This couldn’t be found.',
  429: 'Too many tries. Wait a moment and try again.',
  501: 'This isn’t available yet.',
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  return typeof v === 'object' && v !== null && typeof (v as ApiErrorBody).code === 'string'
}

/** Build an ApiError from whatever openapi-fetch returned (JSON error body, text, or nothing). */
export function toApiError(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) return new ApiError(status, body.code, body.message || FALLBACK_MESSAGES[status] || 'Something went wrong.', body.fields ?? [])
  const message =
    FALLBACK_MESSAGES[status] ??
    (status === 0 ? 'Couldn’t reach the server. Check your connection and try again.' : 'Something went wrong. Try again.')
  return new ApiError(status, status === 0 ? 'network_error' : `http_${status}`, message)
}

/**
 * Unwrap an openapi-fetch result: return `data` or throw an ApiError.
 *
 *   const me = await unwrap(apiClient.GET('/me'))
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response }
  try {
    result = await call
  } catch {
    throw toApiError(0, undefined)
  }
  const { data, error, response } = result
  if (!response.ok || error !== undefined) throw toApiError(response.status, error)
  return data as T
}

/** True for errors where retrying won't help (4xx, 501). Used by the QueryClient. */
export function isFinalError(error: unknown): boolean {
  return error instanceof ApiError && ((error.status >= 400 && error.status < 500) || error.status === 501)
}
