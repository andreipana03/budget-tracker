import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/errors'

import { errorMessage, formErrors } from './field-errors'
import { isPasswordAcceptable, passwordRules, sameAsIdentity } from './password-rules'
import { safeNext } from './safe-next'

const met = (password: string, identity?: { username?: string; email?: string }) =>
  Object.fromEntries(passwordRules(password, identity).map((r) => [r.key, r.met]))

describe('passwordRules', () => {
  it('starts with nothing met', () => {
    expect(met('', { username: 'ana', email: 'ana@x.ro' })).toEqual({
      length: false,
      uppercase: false,
      lowercase: false,
      digit: false,
      symbol: false,
      different: false,
    })
  })

  it('ticks rules off as they are met', () => {
    expect(met('abc')).toMatchObject({ lowercase: true, uppercase: false, digit: false, symbol: false, length: false })
    expect(met('Abc1')).toMatchObject({ uppercase: true, digit: true, symbol: false })
    expect(met('Abc1!xyz')).toMatchObject({ length: true, symbol: true })
    expect(isPasswordAcceptable('Abc1!xyz')).toBe(true)
  })

  it('omits the identity rule when identity is unknown', () => {
    expect(passwordRules('x').map((r) => r.key)).not.toContain('different')
  })

  it('counts length in characters, between 8 and 128', () => {
    expect(met('Ăb1!ĂĂĂĂ').length).toBe(true)
    expect(met('Ab1!' + 'x'.repeat(124)).length).toBe(true)
    expect(met('Ab1!' + 'x'.repeat(125)).length).toBe(false)
  })

  it('does not count spaces as symbols (like the API)', () => {
    expect(met('Abc1 xyz').symbol).toBe(false)
    expect(met('Abc1_xyz').symbol).toBe(true)
  })

  it('treats non-Latin letters like the API', () => {
    expect(met('Ăă').uppercase).toBe(true)
    expect(met('Ăă').lowercase).toBe(true)
  })

  it('rejects the username, the email and its local part, case-insensitively', () => {
    const id = { username: 'Ana.Pop', email: 'Ana@Example.com' }
    expect(sameAsIdentity('ana.pop', id)).toBe(true)
    expect(sameAsIdentity(' ANA@example.com ', id)).toBe(true)
    expect(sameAsIdentity('ana', id)).toBe(true)
    expect(sameAsIdentity('Ana.Pop1!', id)).toBe(false)
    expect(met('Ana.Pop1!', id).different).toBe(true)
  })
})

describe('safeNext', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeNext('/budgets?month=2026-11#x')).toBe('/budgets?month=2026-11#x')
    expect(safeNext('/settings/accounts')).toBe('/settings/accounts')
  })

  it('falls back to Home for missing or foreign targets', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'budgets',
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      'javascript:alert(1)',
      ' /budgets',
    ])
      expect(safeNext(bad)).toBe('/')
  })

  it('never loops back to an auth page', () => {
    expect(safeNext('/sign-in?next=/x')).toBe('/')
    expect(safeNext('/sign-up')).toBe('/')
    expect(safeNext('/sign-in-help')).toBe('/sign-in-help')
  })

  it('uses the given fallback', () => {
    expect(safeNext('//x', '/settings')).toBe('/settings')
  })
})

describe('formErrors', () => {
  const fields = ['email', 'username', 'password'] as const

  it('maps 422 field errors, first message per field', () => {
    const err = new ApiError(422, 'validation_failed', 'Check the highlighted fields.', [
      { field: 'password', code: 'missing_digit', message: 'Add a number.' },
      { field: 'password', code: 'missing_symbol', message: 'Add a symbol, like ! or #.' },
      { field: 'email', code: 'invalid_format', message: 'Enter an email address like name@example.com.' },
    ])
    expect(formErrors(err, fields)).toEqual({
      fields: { password: 'Add a number.', email: 'Enter an email address like name@example.com.' },
    })
  })

  it('maps 409 email_taken / username_taken without fields to the field', () => {
    expect(formErrors(new ApiError(409, 'email_taken', 'An account with this email already exists.'), fields)).toEqual({
      fields: { email: 'An account with this email already exists.' },
    })
    expect(formErrors(new ApiError(409, 'username_taken', 'This username is taken.'), fields).fields.username).toBe(
      'This username is taken.',
    )
  })

  it('applies aliases (newPassword → password)', () => {
    const err = new ApiError(422, 'validation_failed', 'x', [{ field: 'newPassword', code: 'too_short', message: 'Use at least 8 characters.' }])
    expect(formErrors(err, ['password'] as const, { newPassword: 'password' }).fields.password).toBe('Use at least 8 characters.')
  })

  it('puts everything else on the form, in the app’s voice', () => {
    expect(formErrors(new ApiError(401, 'invalid_credentials', 'nope'), fields)).toEqual({
      fields: {},
      form: 'That email, username or password isn’t right.',
    })
    expect(formErrors(new ApiError(429, 'rate_limited', 'x'), fields).form).toMatch(/^Too many tries/)
    expect(formErrors(new Error('boom'), fields).form).toBe('Something went wrong. Try again.')
    expect(errorMessage(new ApiError(0, 'network_error', 'Couldn’t reach the server.'))).toBe('Couldn’t reach the server.')
  })

  it('ignores fields the form doesn’t have', () => {
    const err = new ApiError(422, 'validation_failed', 'Check it.', [{ field: 'deviceName', code: 'too_long', message: 'Too long.' }])
    expect(formErrors(err, fields)).toEqual({ fields: {}, form: 'Check it.' })
  })
})
