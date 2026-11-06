// PLACEHOLDER — W-auth replaces this file.
import { Link } from 'react-router'

import { Card } from '@/components/ui/List'

export function VerifyEmailPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-bg px-4 pt-[calc(var(--safe-top)+64px)] lg:items-center lg:pt-0">
      <Card padded className="w-full max-w-[400px]">
        <h1 className="m-0 text-large-title">Verify Email</h1>
        <p className="m-0 mt-2 text-subhead text-label-2">Email verification is coming next.</p>
        <Link to="/" className="mt-4 inline-block text-subhead text-tint-text">
          Go to the app
        </Link>
      </Card>
    </main>
  )
}
