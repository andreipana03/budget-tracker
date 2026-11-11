import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Button, ButtonLink } from '@/components/ui/Button'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'
import { queryKeys } from '@/lib/api/queries'

import { useAuth } from './auth-context'
import { AuthLayout, FieldNote } from './AuthLayout'
import { errorMessage } from './field-errors'

type Stage = 'verifying' | 'done' | 'invalid' | 'error'

// One request per token, even when React StrictMode runs the effect twice.
const attempts = new Map<string, Promise<Stage>>()

function verifyOnce(token: string): Promise<Stage> {
  let attempt = attempts.get(token)
  if (!attempt) {
    attempt = unwrap(apiClient.POST('/auth/verify-email', { body: { token } })).then(
      (): Stage => 'done',
      (e: unknown): Stage => (e instanceof ApiError && (e.code === 'invalid_token' || e.status === 400) ? 'invalid' : 'error'),
    )
    attempts.set(token, attempt)
    // A network failure may be retried with the same link.
    void attempt.then((s) => s === 'error' && attempts.delete(token))
  }
  return attempt
}

/**
 * Verify Email (/verify-email?token=…): confirms once on load. Works signed in or out;
 * when signed in, the cached user is marked verified so Settings updates at once.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { status, user, updateUser } = useAuth()
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<Stage>(token ? 'verifying' : 'invalid')
  const [attempt, setAttempt] = useState(0)
  const [resend, setResend] = useState<{ state: 'idle' | 'sending' | 'sent'; error?: string }>({ state: 'idle' })

  useEffect(() => {
    if (!token) return
    let active = true
    verifyOnce(token).then((s) => active && setStage(s))
    return () => {
      active = false
    }
  }, [token, attempt])

  useEffect(() => {
    if (stage !== 'done' || !user) return
    if (!user.emailVerified) updateUser({ ...user, emailVerified: true })
    void queryClient.invalidateQueries({ queryKey: queryKeys.me })
  }, [stage, user, updateUser, queryClient])

  const signedIn = status === 'signedIn'

  const sendAgain = async () => {
    setResend({ state: 'sending' })
    try {
      await unwrap(apiClient.POST('/me/resend-verification'))
      setResend({ state: 'sent' })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_verified') setStage('done')
      else setResend({ state: 'idle', error: errorMessage(e) })
    }
  }

  if (stage === 'verifying')
    return (
      <AuthLayout title="Confirming Your Email" subtitle="This takes a moment.">
        <p role="status" className="sr-only">
          Confirming your email…
        </p>
      </AuthLayout>
    )

  if (stage === 'done')
    return (
      <AuthLayout title="Email Confirmed" subtitle="Thanks. Your email address is confirmed.">
        <ButtonLink to={signedIn ? '/' : '/sign-in'} variant="prominent" block className="lg:h-9" replace>
          Continue
        </ButtonLink>
      </AuthLayout>
    )

  if (stage === 'error')
    return (
      <AuthLayout title="Couldn’t Confirm Your Email" subtitle="Check your connection and try again.">
        <Button variant="prominent" block className="lg:h-9" onClick={() => {
            setStage('verifying')
            setAttempt((n) => n + 1)
          }}>
          Try Again
        </Button>
      </AuthLayout>
    )

  return (
    <AuthLayout
      title="This Link Has Expired"
      subtitle={
        signedIn
          ? 'Confirmation links work once and only for a day. We can send a new one.'
          : 'Confirmation links work once and only for a day. Sign in to get a new one from Settings.'
      }
    >
      {signedIn ? (
        resend.state === 'sent' ? (
          <>
            <p role="status" className="m-0 text-center text-subhead text-label-2 lg:text-callout">
              A new link is on its way to <span className="font-semibold text-label">{user?.email}</span>.
            </p>
            <ButtonLink to="/" variant="secondary" block className="mt-5 lg:h-9">
              Continue
            </ButtonLink>
          </>
        ) : (
          <>
            <Button variant="prominent" block className="lg:h-9" onClick={sendAgain} aria-disabled={resend.state === 'sending' || undefined}>
              {resend.state === 'sending' ? 'Sending Link…' : 'Resend Link'}
            </Button>
            {resend.error && <FieldNote tone="error">{resend.error}</FieldNote>}
          </>
        )
      ) : status === 'signedOut' ? (
        <ButtonLink to="/sign-in?next=%2Fsettings" variant="prominent" block className="lg:h-9">
          Sign In
        </ButtonLink>
      ) : null}
    </AuthLayout>
  )
}
