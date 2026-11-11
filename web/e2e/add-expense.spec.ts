import { expect, test } from '@playwright/test'

import { WEB_URL } from './env.ts'
import { deleteUser, isCompact, registerViaApi, uniqueUser, type TestUser } from './helpers.ts'

let user: TestUser | undefined

test.afterEach(async () => {
  if (user) await deleteUser(user)
  user = undefined
})

test('sets a budget, adds an expense with the live hint, and sees it on Home and in Activity', async ({ page }, testInfo) => {
  user = await registerViaApi(page, uniqueUser(testInfo, 'add'))

  // Edit Budgets: Groceries 600.
  await page.goto('/budgets?edit=1')
  const budgets = page.getByRole('dialog', { name: 'Edit Budgets' })
  await expect(budgets).toBeVisible()
  await budgets.getByLabel('Groceries').fill('600')
  await expect(budgets.getByText(/600,00\slei/)).toBeVisible() // Monthly Total
  await budgets.getByRole('button', { name: 'Save Budgets' }).click()
  await expect(page.getByText('Budgets saved')).toBeVisible()
  await expect(budgets).toBeHidden()

  // Home now has a budget and nothing spent.
  await page.goto('/')
  const hero = page.getByRole('region', { name: /summary$/ })
  await expect(hero.getByText(/^Left to spend in \w+/)).toBeVisible()
  await expect(hero).toContainText(/600,00\slei/)

  // Add with the Add button: 24,50 in Groceries.
  // Compact: the + next to the tab bar (the empty Recent card has its own "Add Expense" button).
  if (isCompact(page)) await page.getByLabel('Add Expense').click()
  else await page.getByRole('button', { name: 'Add Transaction' }).click()
  const sheet = page.getByRole('dialog', { name: 'New Expense' })
  await expect(sheet).toBeVisible()
  const amount = sheet.getByLabel('Amount in RON')
  await expect(amount).toBeFocused()
  await amount.pressSequentially('24,50')
  await expect(amount).toHaveValue('24,50')
  await sheet.getByRole('radio', { name: 'Groceries' }).click()
  await expect(sheet.getByRole('radio', { name: 'Groceries' })).toHaveAttribute('aria-checked', 'true')
  await expect(sheet.getByText(/^575,50\slei left in Groceries after this$/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Add Expense' }).click()

  await expect(page.getByText('Expense added')).toBeVisible()
  await expect(sheet).toBeHidden()

  // Home: what's left drops by 24,50 and Recent shows the expense.
  await expect(hero).toContainText(/575,50\slei/)
  const recent = page.getByRole('region', { name: 'Recent' })
  await expect(recent.getByText('Groceries').first()).toBeVisible()
  await expect(recent.getByText(/24,50\slei/)).toBeVisible()

  // Activity lists it under Today.
  await page.goto('/activity')
  await expect(page).toHaveURL(`${WEB_URL}/activity`)
  const today = page.getByRole('heading', { level: 3, name: /^Today/ })
  await expect(today).toBeVisible()
  if (isCompact(page)) {
    const group = page.locator('section', { has: today })
    await expect(group.getByRole('link', { name: /Groceries/ })).toContainText(/24,50\slei/)
  } else {
    const table = page.getByRole('listbox', { name: 'Transactions' })
    await expect(table.getByRole('option', { name: /Groceries/ })).toContainText(/24,50\slei/)
  }
})
