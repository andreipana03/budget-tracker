import { useId, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { List } from '@/components/ui/List'
import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'

import { useAuth } from './auth-context'
import { AUTH_LIST, AuthLayout, FieldNote } from './AuthLayout'
import { errorMessage } from './field-errors'
import { InputRow, PasswordRow } from './fields'
import { GoogleSignIn } from './GoogleSignIn'
import { safeNext } from './safe-next'

/** Sign In (/sign-in?next=…): email or username + password, or Google. */
export function SignInPage() {
  const { status, signIn } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  // A signed-in visitor (or one who just signed in) goes straight to where they were headed.
  if (status === 'signedIn') return <Navigate to={next} replace />
  if (status === 'unknown') return <div className="min-h-dvh bg-bg" aria-busy="true" />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!identifier.trim() || !password) {
      setError(!identifier.trim() ? 'Enter your email or username.' : 'Enter your password.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const response = await unwrap(
        apiClient.POST('/auth/login', { body: { identifier: identifier.trim(), password, platform: 'web' } }),
      )
      signIn(response)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  const forgotHref = identifier.includes('@')
    ? `/forgot-password?email=${encodeURIComponent(identifier.trim())}`
    : '/forgot-password'
  const describedBy = error ? errorId : undefined

  return (
    <AuthLayout title="Budget Tracker" subtitle="Sign in to see what’s left to spend this month." documentTitle="Sign In">
      <form onSubmit={submit} noValidate aria-label="Sign In">
        <List className={AUTH_LIST}>
          <InputRow
            label="Email or Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !password) {
                e.preventDefault()
                passwordRef.current?.focus()
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
          <PasswordRow
            ref={passwordRef}
            label="Password"
            name="password"
            autoComplete="current-password"
            enterKeyHint="go"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
        </List>
        {error && (
          <FieldNote id={errorId} tone="error">
            {error}
          </FieldNote>
        )}
        <Link to={forgotHref} className="inline-block px-4 py-2.5 text-subhead text-tint-text lg:px-1 lg:text-callout">
          Forgot Password?
        </Link>
        <Button type="submit" variant="prominent" block className="mt-3 lg:h-9" aria-disabled={submitting || undefined}>
          {submitting ? 'Signing In…' : 'Sign In'}
        </Button>
      </form>

      <GoogleSignIn text="signin_with" />

      <p className="m-0 mt-7 text-center text-subhead text-label-2 lg:text-callout">
        New to Budget Tracker?{' '}
        <Link to="/sign-up" className="-my-2 inline-block py-2 font-semibold text-tint-text">
          Create Account
        </Link>
      </p>
    </AuthLayout>
  )
}
