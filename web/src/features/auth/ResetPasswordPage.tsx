import { useId, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Button, ButtonLink } from '@/components/ui/Button'
import { List } from '@/components/ui/List'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'

import { useAuth } from './auth-context'
import { AUTH_LIST, AuthLayout, FieldNote } from './AuthLayout'
import { formErrors } from './field-errors'
import { PasswordChecklist, PasswordRow } from './fields'
import { isPasswordAcceptable, passwordRules } from './password-rules'

type Stage = 'form' | 'done' | 'invalid'

/**
 * Reset Password (/reset-password?token=…): a new password with the live checklist.
 * Success signs every device out, so it ends on Sign In. A bad or used link explains
 * itself and offers a new one.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { status, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [stage, setStage] = useState<Stage>(token ? 'form' : 'invalid')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const ids = { rules: useId(), error: useId() }

  const rules = passwordRules(password)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!isPasswordAcceptable(password)) {
      setError('Your password needs everything in the list.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await unwrap(apiClient.POST('/auth/reset-password', { body: { token, password } }))
      // Every session was revoked, including this browser's if it was signed in.
      if (status === 'signedIn') await signOut()
      setStage('done')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_token') setStage('invalid')
      else {
        const mapped = formErrors(err, ['password'] as const)
        setError(mapped.fields.password ?? mapped.form ?? null)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'done')
    return (
      <AuthLayout
        title="Your Password Is Changed"
        subtitle="You’re signed out on every device. Sign in with your new password."
      >
        <ButtonLink to="/sign-in" variant="prominent" block className="lg:h-9">
          Sign In
        </ButtonLink>
      </AuthLayout>
    )

  if (stage === 'invalid')
    return (
      <AuthLayout
        title="This Link Has Expired"
        subtitle="Reset links work once and only for an hour. Ask for a new one and use the latest email."
      >
        <ButtonLink to="/forgot-password" variant="prominent" block className="lg:h-9">
          Send a New Link
        </ButtonLink>
        <p className="m-0 mt-7 text-center text-subhead lg:text-callout">
          <Link to="/sign-in" className="-my-2 inline-block py-2 text-tint-text">
            Back to Sign In
          </Link>
        </p>
      </AuthLayout>
    )

  return (
    <AuthLayout title="Choose a New Password" documentTitle="Reset Password" subtitle="You’ll use it to sign in on every device.">
      <form onSubmit={submit} noValidate aria-label="Reset Password">
        {/* Lets password managers save the new password against the right account. */}
        <input type="text" name="username" autoComplete="username" hidden readOnly />
        <List className={AUTH_LIST}>
          <PasswordRow
            label="New Password"
            name="new-password"
            autoComplete="new-password"
            enterKeyHint="done"
            maxLength={128}
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids.rules}${error ? ` ${ids.error}` : ''}`}
          />
        </List>
        {error && (
          <FieldNote id={ids.error} tone="error">
            {error}
          </FieldNote>
        )}
        <PasswordChecklist id={ids.rules} rules={rules} />
        <Button type="submit" variant="prominent" block className="mt-6 lg:h-9" aria-disabled={submitting || undefined}>
          {submitting ? 'Changing Password…' : 'Change Password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
