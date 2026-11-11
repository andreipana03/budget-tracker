import { expect, test, type Page } from '@playwright/test'

import { WEB_URL } from './env.ts'
import { api, deleteUser, isCompact, registerViaApi, uniqueUser, type TestUser } from './helpers.ts'

const TITLE = 'Corner Shop'

let user: TestUser | undefined

test.afterEach(async () => {
  if (user) await deleteUser(user)
  user = undefined
})

/** A fresh user with one expense today (created through the API). */
async function userWithOneExpense(page: Page, testInfo: Parameters<typeof uniqueUser>[0]) {
  const registered = await registerViaApi(page, uniqueUser(testInfo, 'del'))
  user = registered
  const token = registered.accessToken
  const household = await api<{ today: string; homeCurrency: string }>(page, token, 'GET', '/household')
  const categories = await api<{ id: string; name: string }[]>(page, token, 'GET', '/categories')
  const accounts = await api<{ items: { id: string; currency: string }[] }>(page, token, 'GET', '/accounts')
  const groceries = categories.find((c) => c.name === 'Groceries')
  expect(groceries, 'default Groceries category').toBeTruthy()
  await api(page, token, 'POST', '/transactions', {
    kind: 'expense',
    title: TITLE,
    occurredOn: household.today,
    categoryId: groceries!.id,
    accountId: accounts.items[0].id,
    amountMinor: 1299,
    currency: accounts.items[0].currency,
  })
}

const deleteRequest = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/api\/transactions\//.test(r.url()) && r.ok())

test('deletes an expense, brings it back with Undo, and deletes it for good', async ({ page }, testInfo) => {
  await userWithOneExpense(page, testInfo)
  await page.goto('/activity')
  const undoToast = page.getByText('Expense deleted')
  const undo = page.getByRole('button', { name: 'Undo' })

  if (isCompact(page)) {
    const row = page.getByRole('link', { name: new RegExp(TITLE) })

    // Detail screen → Delete → Undo.
    await row.click()
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    let deleted = deleteRequest(page)
    await page.getByRole('button', { name: 'Delete Expense' }).click()
    await deleted
    await expect(page).toHaveURL(`${WEB_URL}/activity`)
    await expect(undoToast).toBeVisible()
    await expect(row).toBeHidden()
    await undo.click()
    await expect(row).toBeVisible()

    // Delete again and let the toast go.
    await row.click()
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    deleted = deleteRequest(page)
    await page.getByRole('button', { name: 'Delete Expense' }).click()
    await deleted
    await expect(page).toHaveURL(`${WEB_URL}/activity`)
    await expect(row).toBeHidden()
  } else {
    const table = page.getByRole('listbox', { name: 'Transactions' })
    const row = table.getByRole('option', { name: new RegExp(TITLE) })

    // Select it and press Delete → Undo.
    await row.click()
    await expect(row).toHaveAttribute('aria-selected', 'true')
    let deleted = deleteRequest(page)
    await page.keyboard.press('Delete')
    await deleted
    await expect(undoToast).toBeVisible()
    await expect(row).toBeHidden()
    await undo.click()
    await expect(row).toBeVisible()

    // Delete again with the inspector's Delete and let the toast go.
    const inspector = page.getByRole('complementary', { name: 'Transaction details' })
    await expect(inspector).toContainText(TITLE)
    deleted = deleteRequest(page)
    await inspector.getByRole('button', { name: 'Delete' }).click()
    await deleted
    await expect(row).toBeHidden()
  }

  await page.reload()
  await expect(page.getByText('No Expenses Yet')).toBeVisible()
  await expect(page.getByText(TITLE)).toHaveCount(0)
})
