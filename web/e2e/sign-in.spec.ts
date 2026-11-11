import { expect, test, type Page } from '@playwright/test'

import { ADMIN, WEB_URL } from './env.ts'
import { isCompact, watchConsole } from './helpers.ts'

async function signIn(page: Page, identifier: string, password: string) {
  await page.goto('/sign-in')
  const form = page.getByRole('form', { name: 'Sign In' })
  await form.getByLabel('Email or Username').fill(identifier)
  await form.getByLabel('Password', { exact: true }).fill(password)
  await form.getByRole('button', { name: 'Sign In' }).click()
}

async function expectHome(page: Page) {
  await expect(page).toHaveURL(`${WEB_URL}/`)
  await expect(page.getByText(/^Left to spend in \w+/)).toBeVisible()
  await expect(page.getByRole('img', { name: /^Spent .+ of .+\./ })).toBeVisible()
}

/** A level-1 heading that starts with `title` (the desktop toolbar adds context after it). */
const screenHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 1, name: new RegExp(`^${title}\\b`) })

/** Goes to a section the way people do: the tab bar on iPhone, the sidebar on desktop. */
async function openSection(page: Page, name: 'Activity' | 'Budgets' | 'Insights' | 'Subscriptions' | 'Settings') {
  if (isCompact(page)) {
    if (name === 'Settings') {
      await page.getByRole('tab', { name: 'Home' }).click()
      await page.getByRole('link', { name: 'Profile and Settings' }).click()
    } else if (name === 'Subscriptions') {
      // Compact has no Subscriptions tab: it's pushed from Insights.
      await page.getByRole('tab', { name: 'Insights' }).click()
      await expect(screenHeading(page, 'Insights')).toBeVisible()
      await page.getByRole('link', { name: 'View Subscriptions' }).last().click()
    } else {
      await page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name }).click()
    }
  } else {
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
    await sidebar.getByRole('link', { name: new RegExp(`^${name}`) }).click()
  }
}

test.describe('Sign In', () => {
  test('signs in by username and visits every screen without console errors', async ({ page }) => {
    await signIn(page, ADMIN.username, ADMIN.password)
    await expectHome(page)

    // The signed-out refresh before sign-in may log a 401; watch from Home on.
    const consoleErrors = watchConsole(page)
    await page.reload()
    await expectHome(page)
    expect(consoleErrors.take(), 'console errors on Home').toEqual([])

    const screens = [
      { name: 'Activity', path: '/activity', ready: () => expect(page.getByText(/^Today|^Yesterday|^\w+day, /).first()).toBeVisible() },
      { name: 'Budgets', path: '/budgets', ready: () => expect(page.getByRole('img', { name: /^Spent / }).first()).toBeVisible() },
      { name: 'Insights', path: '/insights', ready: () => expect(page.getByRole('heading', { name: 'By Category' })).toBeVisible() },
      { name: 'Subscriptions', path: '/subscriptions', ready: () => expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible() },
      { name: 'Settings', path: '/settings', ready: () => expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible() },
    ] as const

    for (const s of screens) {
      await openSection(page, s.name)
      await expect(page).toHaveURL(`${WEB_URL}${s.path}`)
      await expect(screenHeading(page, s.name)).toBeVisible()
      await s.ready()
      expect(consoleErrors.take(), `console errors on ${s.name}`).toEqual([])
    }

    await page.getByRole('button', { name: 'Sign Out' }).click()
    await expect(page).toHaveURL(`${WEB_URL}/sign-in`)
    await expect(page.getByRole('form', { name: 'Sign In' })).toBeVisible()

    await page.goto('/')
    await expect(page).toHaveURL(`${WEB_URL}/sign-in`)
    await expect(page.getByRole('form', { name: 'Sign In' })).toBeVisible()
  })

  test('signs in by email', async ({ page }) => {
    await signIn(page, ADMIN.email, ADMIN.password)
    await expectHome(page)
  })

  test('shows an inline error for a wrong password', async ({ page }) => {
    await signIn(page, ADMIN.username, 'NotThePassword@1')
    await expect(page.getByRole('alert')).toHaveText(/That email, username or password isn.t right\./)
    await expect(page).toHaveURL(`${WEB_URL}/sign-in`)
    await expect(page.getByLabel('Email or Username')).toHaveAttribute('aria-invalid', 'true')
  })
})
