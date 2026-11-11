import { useId, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Button, ButtonLink } from '@/components/ui/Button'
import { List } from '@/components/ui/List'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'

import { AUTH_LIST, AuthLayout, FieldNote } from './AuthLayout'
import { errorMessage } from './field-errors'
import { InputRow } from './fields'

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Forgot Password (/forgot-password?email=…): emails a reset link. The answer is
 * always "Check your email" — the API never says whether an address has an account.
 */
export function ForgotPasswordPage() {
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const errorId = useId()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const address = email.trim()
    if (!EMAIL_SHAPE.test(address)) {
      setError('Enter an email address like name@example.com.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await unwrap(apiClient.POST('/auth/forgot-password', { body: { email: address } }))
      setSentTo(address)
    } catch (err) {
      // Validation and connection problems are worth fixing; anything else still gets the same answer.
      if (err instanceof ApiError && (err.status === 422 || err.status === 0 || err.status === 429))
        setError(err.fieldMessage('email') ?? errorMessage(err))
      else setSentTo(address)
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo)
    return (
      <AuthLayout
        title="Check Your Email"
        documentTitle="Check Your Email"
        subtitle={
          <>
            If <span className="font-semibold text-label">{sentTo}</span> has an account, a link to choose a new password is on
            its way. The link expires in an hour.
          </>
        }
      >
        <ButtonLink to="/sign-in" variant="prominent" block className="lg:h-9">
          Back to Sign In
        </ButtonLink>
        <p className="m-0 mt-5 text-center text-subhead text-label-2 lg:text-callout">
          No email after a few minutes? Check your spam folder or{' '}
          <button type="button" onClick={() => setSentTo(null)} className="-my-2 py-2 font-semibold text-tint-text">
            Try Again
          </button>
        </p>
      </AuthLayout>
    )

  return (
    <AuthLayout title="Forgot Password" subtitle="Enter the email you signed up with and we’ll send you a link to choose a new password.">
      <form onSubmit={submit} noValidate aria-label="Forgot Password">
        <List className={AUTH_LIST}>
          <InputRow
            label="Email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </List>
        {error && (
          <FieldNote id={errorId} tone="error">
            {error}
          </FieldNote>
        )}
        <Button type="submit" variant="prominent" block className="mt-5 lg:h-9" aria-disabled={submitting || undefined}>
          {submitting ? 'Sending Link…' : 'Send Reset Link'}
        </Button>
      </form>
      <p className="m-0 mt-7 text-center text-subhead lg:text-callout">
        <Link to="/sign-in" className="-my-2 inline-block py-2 text-tint-text">
          Back to Sign In
        </Link>
      </p>
    </AuthLayout>
  )
}
