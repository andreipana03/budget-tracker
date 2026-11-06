import { describe, expect, it } from 'vitest'

import { ApiError, isFinalError, toApiError, unwrap } from './errors'

const res = (status: number) => new Response(null, { status })

describe('api errors', () => {
  it('keeps the API code and message', async () => {
    const call = Promise.resolve({
      error: { code: 'version_conflict', message: 'Someone else changed this.', fields: [] },
      response: res(409),
    })
    const err = await unwrap(call).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'version_conflict', message: 'Someone else changed this.' })
  })

  it('returns data on success', async () => {
    await expect(unwrap(Promise.resolve({ data: { ok: 1 }, response: res(200) }))).resolves.toEqual({ ok: 1 })
  })

  it('handles bodies that are not API errors', () => {
    expect(toApiError(501, 'Not Implemented')).toMatchObject({ code: 'http_501', message: 'This isn’t available yet.' })
    expect(toApiError(0, undefined).code).toBe('network_error')
  })

  it('reads field errors', () => {
    const e = toApiError(422, {
      code: 'validation_failed',
      message: 'Check the highlighted fields.',
      fields: [{ field: 'password', code: 'too_short', message: 'Use at least 8 characters.' }],
    })
    expect(e.fieldMessage('password')).toBe('Use at least 8 characters.')
  })

  it('does not retry client errors', () => {
    expect(isFinalError(toApiError(401, undefined))).toBe(true)
    expect(isFinalError(toApiError(501, undefined))).toBe(true)
    expect(isFinalError(toApiError(503, undefined))).toBe(false)
  })
})
