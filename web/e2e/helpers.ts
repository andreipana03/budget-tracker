import { expect, request as playwrightRequest, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

import { MAILPIT_URL, WEB_URL } from './env.ts'

/** Meets every password rule (length, upper, lower, digit, symbol). */
export const STRONG_PASSWORD = 'Budget-e2e-2026!'

export interface TestUser {
  email: string
  username: string
  password: string
}

/** A unique user per test: usernames are 3–30 of a–z 0–9 . _ - */
export function uniqueUser(testInfo: TestInfo, prefix = 'e2e'): TestUser {
  const project = testInfo.project.name.startsWith('iphone') ? 'i' : 'd'
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const username = `${prefix}-${project}${testInfo.workerIndex}-${id}`.slice(0, 30)
  return { email: `${username}@e2e.budget-tracker.test`, username, password: STRONG_PASSWORD }
}

export interface Registered extends TestUser {
  accessToken: string
}

/**
 * Creates the account through the API with the page's own request context, so the
 * HttpOnly refresh cookie lands in the browser and loading the app restores the session.
 */
export async function registerViaApi(page: Page, user: TestUser): Promise<Registered> {
  const res = await page.request.post('/api/auth/register', {
    data: { email: user.email, username: user.username, password: user.password, platform: 'web' },
  })
  expect(res.status(), await res.text()).toBe(201)
  const body = (await res.json()) as { accessToken: string }
  return { ...user, accessToken: body.accessToken }
}

/** Authenticated JSON call through the Vite proxy. */
export async function api<T>(
  page: Page,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await page.request.fetch(`/api${path}`, {
    method,
    data,
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true)
  return (res.status() === 204 ? undefined : await res.json()) as T
}

/**
 * Deletes a test account (DELETE /me). Signs in again from a separate request context
 * (platform "ios", so no cookie is involved), which works even after the browser signed out.
 */
export async function deleteUser(user: TestUser): Promise<void> {
  const ctx: APIRequestContext = await playwrightRequest.newContext({ baseURL: WEB_URL })
  try {
    const login = await ctx.post('/api/auth/login', {
      data: { identifier: user.username, password: user.password, platform: 'ios', deviceName: 'e2e cleanup' },
    })
    if (!login.ok()) return // never created, or already gone
    const { accessToken } = (await login.json()) as { accessToken: string }
    const res = await ctx.delete('/api/me', { headers: { Authorization: `Bearer ${accessToken}` } })
    expect(res.status(), await res.text()).toBe(204)
  } finally {
    await ctx.dispose()
  }
}

/** Console errors and uncaught exceptions seen by the page since the last `take()`. */
export function watchConsole(page: Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()} (${msg.location().url})`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return {
    take(): string[] {
      return errors.splice(0)
    },
  }
}

/** True on the compact layout (tab bar), false on desktop (sidebar ≥ 1024px). */
export function isCompact(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 1024
}

interface MailpitSummary {
  ID: string
  Subject: string
}

/** Polls Mailpit for the newest email sent to `to` and returns its plain-text body. */
export async function waitForEmail(to: string, subject?: RegExp): Promise<{ subject: string; text: string }> {
  let found: MailpitSummary | undefined
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
        if (!res.ok) return undefined
        const body = (await res.json()) as { messages: MailpitSummary[] }
        found = body.messages.find((m) => !subject || subject.test(m.Subject))
        return found?.ID
      },
      { message: `an email to ${to} in Mailpit`, timeout: 15_000 },
    )
    .toBeTruthy()
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${found!.ID}`)
  const message = (await res.json()) as { Subject: string; Text: string; HTML: string }
  return { subject: message.Subject, text: message.Text || message.HTML }
}
