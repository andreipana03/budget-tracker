import { useId, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'

import { Button } from '@/components/ui/Button'
import { List } from '@/components/ui/List'
import { useToast } from '@/components/ui/use-toast'
import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'

import { useAuth } from './auth-context'
import { AUTH_LIST, AuthLayout, FieldNote } from './AuthLayout'
import { formErrors, type FormErrors } from './field-errors'
import { InputRow, PasswordChecklist, PasswordRow, UsernameStatus } from './fields'
import { GoogleSignIn } from './GoogleSignIn'
import { isPasswordAcceptable, passwordRules } from './password-rules'
import { normalizeUsernameInput, USERNAME_PATTERN, useUsernameAvailability } from './useUsernameAvailability'

const FIELDS = ['email', 'username', 'password'] as const
type Field = (typeof FIELDS)[number]

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Create Account (/sign-up): email, username (live availability) and password (live
 * checklist). The API creates the household (RON, a "Cash" account) and sends the
 * verification email; we sign in and go Home.
 */
export function SignUpPage() {
  const { status, signIn } = useAuth()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors<Field>>({ fields: {} })
  const [submitting, setSubmitting] = useState(false)
  const availability = useUsernameAvailability(username)
  const ids = { email: useId(), username: useId(), password: useId(), form: useId() }

  if (status === 'signedIn') return <Navigate to="/" replace />
  if (status === 'unknown') return <div className="min-h-dvh bg-bg" aria-busy="true" />

  const rules = passwordRules(password, { username, email })

  const clearField = (f: Field) =>
    setErrors((prev) => (prev.fields[f] || prev.form ? { fields: { ...prev.fields, [f]: undefined } } : prev))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const local: FormErrors<Field> = { fields: {} }
    if (!EMAIL_SHAPE.test(email.trim())) local.fields.email = 'Enter an email address like name@example.com.'
    if (!USERNAME_PATTERN.test(username)) local.fields.username = 'Use 3–30 letters, numbers, dots, dashes or underscores.'
    else if (availability.status === 'unavailable') local.fields.username = availability.message
    if (!isPasswordAcceptable(password, { username, email })) local.fields.password = 'Your password needs everything in the list.'
    if (Object.values(local.fields).some(Boolean)) {
      setErrors(local)
      const first = FIELDS.find((f) => local.fields[f])
      if (first) document.getElementById(ids[first])?.focus()
      return
    }
    setErrors({ fields: {} })
    setSubmitting(true)
    try {
      const response = await unwrap(
        apiClient.POST('/auth/register', { body: { email: email.trim(), username, password, platform: 'web' } }),
      )
      signIn(response)
      toast.show({ title: 'Check your email to confirm it', timeout: 8000 })
    } catch (err) {
      const mapped = formErrors(err, FIELDS)
      setErrors(mapped)
      setSubmitting(false)
      const first = FIELDS.find((f) => mapped.fields[f])
      if (first) document.getElementById(ids[first])?.focus()
    }
  }

  const fieldProps = (f: Field, noteId?: string) => ({
    id: ids[f],
    'aria-invalid': errors.fields[f] ? true : undefined,
    'aria-describedby': noteId,
  })

  return (
    <AuthLayout title="Create Account" subtitle="Budget by the month and see what’s left at a glance.">
      <form onSubmit={submit} noValidate aria-label="Create Account" className="flex flex-col gap-5">
        <div>
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
              enterKeyHint="next"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                clearField('email')
              }}
              {...fieldProps('email', errors.fields.email ? `${ids.email}-note` : undefined)}
            />
          </List>
          {errors.fields.email && (
            <FieldNote id={`${ids.email}-note`} tone="error">
              {errors.fields.email}
            </FieldNote>
          )}
        </div>

        <div>
          <List className={AUTH_LIST}>
            <InputRow
              label="Username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              maxLength={30}
              value={username}
              onChange={(e) => {
                setUsername(normalizeUsernameInput(e.target.value))
                clearField('username')
              }}
              {...fieldProps('username', `${ids.username}-note`)}
            />
          </List>
          <UsernameStatus id={`${ids.username}-note`} state={availability} error={errors.fields.username} />
        </div>

        <div>
          <List className={AUTH_LIST}>
            <PasswordRow
              label="Password"
              name="new-password"
              autoComplete="new-password"
              enterKeyHint="go"
              maxLength={128}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearField('password')
              }}
              {...fieldProps('password', `${ids.password}-rules${errors.fields.password ? ` ${ids.password}-note` : ''}`)}
            />
          </List>
          {errors.fields.password && (
            <FieldNote id={`${ids.password}-note`} tone="error">
              {errors.fields.password}
            </FieldNote>
          )}
          <PasswordChecklist id={`${ids.password}-rules`} rules={rules} />
        </div>

        {errors.form && (
          <FieldNote id={ids.form} tone="error" className="-mt-2 pt-0">
            {errors.form}
          </FieldNote>
        )}

        <Button type="submit" variant="prominent" block className="lg:h-9" aria-disabled={submitting || undefined}>
          {submitting ? 'Creating Account…' : 'Create Account'}
        </Button>
      </form>

      <GoogleSignIn text="signup_with" />

      <p className="m-0 mt-7 text-center text-subhead text-label-2 lg:text-callout">
        Already have an account?{' '}
        <Link to="/sign-in" className="-my-2 inline-block py-2 font-semibold text-tint-text">
          Sign In
        </Link>
      </p>
    </AuthLayout>
  )
}
