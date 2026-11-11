/**
 * Google Identity Services (https://accounts.google.com/gsi/client), loaded once and
 * only when a Google button is shown. Typed minimally here (no extra dependency).
 * The button is Google's own rendered button (their branding rules), never a copy.
 */

export interface GoogleCredentialResponse {
  /** The ID token (JWT) to send to POST /auth/google. */
  credential: string
  select_by?: string
}

export interface GoogleButtonOptions {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  /** px, 200–400. */
  width?: number
  locale?: string
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    ux_mode?: 'popup' | 'redirect'
    use_fedcm_for_button?: boolean
  }): void
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

/** The OAuth web client id. Without it no Google UI is rendered at all. */
export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? ''

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
let loading: Promise<GoogleAccountsId> | null = null
let initialized = false
let currentHandler: ((response: GoogleCredentialResponse) => void) | null = null

function loadScript(): Promise<GoogleAccountsId> {
  loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id)
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('gsi missing')))
    script.onerror = () => reject(new Error('gsi failed to load'))
    document.head.appendChild(script)
  }).catch((e: unknown) => {
    loading = null // allow a retry on the next mount
    throw e
  })
  return loading
}

/**
 * Load GIS (once), initialize it (once) and route credentials to `onCredential`
 * (the latest caller wins — only one Google button is on screen at a time).
 */
export async function getGoogleIdentity(onCredential: (response: GoogleCredentialResponse) => void): Promise<GoogleAccountsId> {
  currentHandler = onCredential
  const id = await loadScript()
  if (!initialized) {
    id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => currentHandler?.(response),
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup',
    })
    initialized = true
  }
  return id
}
