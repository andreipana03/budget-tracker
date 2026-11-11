import { expect, test } from '@playwright/test'

import { DEMO_USERNAME, WEB_URL } from './env.ts'
import { deleteUser, uniqueUser, waitForEmail, type TestUser } from './helpers.ts'

test.describe('Create Account', () => {
  let created: TestUser | undefined

  test.afterEach(async () => {
    if (created) await deleteUser(created)
    created = undefined
  })

  test('signs up, lands on Home without a budget, and confirms the email from Mailpit', async ({ page }, testInfo) => {
    const user = uniqueUser(testInfo, 'signup')
    await page.goto('/sign-up')
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible()

    const form = page.getByRole('form', { name: 'Create Account' })
    await form.getByLabel('Email').fill(user.email)
    await form.getByLabel('Username').fill(user.username)
    await expect(page.getByText('Available')).toBeVisible()

    // The checklist ticks as the password is typed.
    const checklist = page.getByRole('list', { name: 'Password needs' })
    const password = form.getByLabel('Password', { exact: true })
    await password.pressSequentially('budget')
    await expect(checklist.getByRole('listitem').filter({ hasText: 'A lowercase letter' })).toContainText('done')
    await expect(checklist.getByRole('listitem').filter({ hasText: 'An uppercase letter' })).toContainText('not yet')
    await password.fill(user.password)
    for (const item of await checklist.getByRole('listitem').all()) await expect(item).toContainText(': done')

    created = user // from here on the account may exist
    await form.getByRole('button', { name: 'Create Account' }).click()

    await expect(page).toHaveURL(`${WEB_URL}/`)
    await expect(page.getByText(/Set a monthly budget to see what.s left/)).toBeVisible()

    const mail = await waitForEmail(user.email)
    const link = mail.text.match(/https?:\/\/\S+\/verify-email\?token=[\w-]+/)?.[0]
    expect(link, `verification link in:\n${mail.text}`).toBeTruthy()
    expect(link!.startsWith(`${WEB_URL}/verify-email`)).toBe(true)

    await page.goto(link!)
    await expect(page.getByRole('heading', { name: /email confirmed/i })).toBeVisible()
    await page.getByRole('link', { name: 'Continue' }).click()
    await expect(page.getByText(/Set a monthly budget to see what.s left/)).toBeVisible()
  })

  test('shows the unmet password rules for a weak password', async ({ page }, testInfo) => {
    const user = uniqueUser(testInfo, 'weak')
    await page.goto('/sign-up')
    const form = page.getByRole('form', { name: 'Create Account' })
    await form.getByLabel('Email').fill(user.email)
    await form.getByLabel('Username').fill(user.username)
    await form.getByLabel('Password', { exact: true }).fill('short')

    const checklist = page.getByRole('list', { name: 'Password needs' })
    await expect(checklist.getByRole('listitem').filter({ hasText: '8 to 128 characters' })).toContainText('not yet')
    await expect(checklist.getByRole('listitem').filter({ hasText: 'An uppercase letter' })).toContainText('not yet')
    await expect(checklist.getByRole('listitem').filter({ hasText: 'A number' })).toContainText('not yet')
    await expect(checklist.getByRole('listitem').filter({ hasText: 'A symbol' })).toContainText('not yet')
    await expect(checklist.getByRole('listitem').filter({ hasText: 'A lowercase letter' })).toContainText(': done')

    await form.getByRole('button', { name: 'Create Account' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Your password needs everything in the list.' })).toBeVisible()
    await expect(page).toHaveURL(/\/sign-up$/)
  })

  test('says a taken username is taken', async ({ page }) => {
    await page.goto('/sign-up')
    const form = page.getByRole('form', { name: 'Create Account' })
    await form.getByLabel('Username').fill(DEMO_USERNAME)
    await expect(page.getByRole('alert').filter({ hasText: /taken/ })).toBeVisible()
  })
})
