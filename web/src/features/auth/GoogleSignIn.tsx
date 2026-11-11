import { useEffect, useRef, useState } from 'react'

import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import { useMediaQuery } from '@/lib/hooks/useMediaQuery'

import { useAuth } from './auth-context'
import { FieldNote, OrSeparator } from './AuthLayout'
import { errorMessage } from './field-errors'
import { GOOGLE_CLIENT_ID, getGoogleIdentity, type GoogleCredentialResponse } from './google-identity'

/**
 * "or" + Google's own rendered button (pill, outline in light / filled_black in dark,
 * full width up to 400px). Renders nothing when VITE_GOOGLE_CLIENT_ID isn't set.
 * On success it signs in; the page's signed-in redirect takes it from there.
 */
export function GoogleSignIn({ text }: { text: 'signin_with' | 'signup_with' }) {
  if (!GOOGLE_CLIENT_ID) return null
  return <GoogleButton text={text} />
}

function GoogleButton({ text }: { text: 'signin_with' | 'signup_with' }) {
  const { signIn } = useAuth()
  const ref = useRef<HTMLDivElement>(null)
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  const signInRef = useRef(signIn)
  useEffect(() => {
    signInRef.current = signIn
  }, [signIn])

  useEffect(() => {
    let cancelled = false
    const onCredential = async ({ credential }: GoogleCredentialResponse) => {
      setError(null)
      setBusy(true)
      try {
        const response = await unwrap(apiClient.POST('/auth/google', { body: { idToken: credential, platform: 'web' } }))
        signInRef.current(response)
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setBusy(false)
      }
    }
    getGoogleIdentity(onCredential)
      .then((id) => {
        const el = ref.current
        if (cancelled || !el) return
        const width = Math.round(Math.min(400, Math.max(200, el.clientWidth)))
        el.replaceChildren()
        id.renderButton(el, {
          type: 'standard',
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          text,
          shape: 'pill',
          logo_alignment: 'center',
          width,
          // The UI is English (design § 1); Google would otherwise guess from the browser.
          locale: 'en',
        })
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [dark, text])

  if (unavailable) return null
  return (
    <>
      <OrSeparator />
      <div aria-busy={busy || undefined} className="flex min-h-11 justify-center [color-scheme:normal]">
        <div ref={ref} className="w-full max-w-[400px] [&>div]:mx-auto" />
      </div>
      {error && <FieldNote tone="error">{error}</FieldNote>}
    </>
  )
}
