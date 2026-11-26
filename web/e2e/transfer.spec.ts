import { expect, test, type Page } from '@playwright/test'

import { WEB_URL } from './env.ts'
import { api, deleteUser, isCompact, registerViaApi, uniqueUser, type TestUser } from './helpers.ts'

let user: TestUser | undefined

test.afterEach(async () => {
  if (user) await deleteUser(user)
  user = undefined
})

const deleteRequest = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/api\/transfers\//.test(r.url()) && r.ok())

test('moves money between accounts, sees it in Activity, and undoes a delete', async ({ page }, testInfo) => {
  // A fresh user has Cash (0 lei); add a card with 1.000 lei.
  const registered = await registerViaApi(page, uniqueUser(testInfo, 'tr'))
  user = registered
  const household = await api<{ today: string }>(page, registered.accessToken, 'GET', '/household')
  await api(page, registered.accessToken, 'POST', '/accounts', {
    name: 'ING Card',
    type: 'bank',
    currency: 'RON',
    openingBalanceMinor: 100000,
    openingBalanceOn: household.today,
  })

  // Compact: "Transfer" on Home's Accounts row. Desktop: the same link in the sidebar.
  await page.goto('/')
  if (isCompact(page)) await page.getByRole('region', { name: 'Accounts' }).getByRole('button', { name: 'Transfer' }).click()
  else await page.getByRole('button', { name: 'Transfer Between Accounts' }).click()

  const sheet = page.getByRole('dialog', { name: 'New Transfer' })
  await expect(sheet).toBeVisible()
  const amount = sheet.getByLabel('Amount to transfer, in RON')
  await expect(amount).toBeFocused()
  // Defaults to the first account (Cash) → the other one; swap to withdraw from the card.
  await expect(sheet.getByRole('button', { name: 'From: Cash' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Swap Accounts' }).click()
  await expect(sheet.getByRole('button', { name: 'From: ING Card' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'To: Cash' })).toBeVisible()
  await amount.pressSequentially('200')
  await expect(sheet.getByText(/^Leaves 800,00\slei in ING Card$/)).toBeVisible()
  await sheet.getByLabel('Note').fill('ATM')
  await sheet.getByRole('button', { name: 'Add Transfer' }).click()

  await expect(page.getByText('Transfer added')).toBeVisible()
  await expect(sheet).toBeHidden()

  // Balances moved; nothing was spent.
  const balances = isCompact(page) ? page.getByRole('region', { name: 'Accounts' }) : page.getByRole('complementary', { name: 'Sidebar' })
  await expect(balances.getByRole('link', { name: /^ING Card/ })).toContainText(/800,00\slei/)
  await expect(balances.getByRole('link', { name: /^Cash/ })).toContainText(/200,00\slei/)

  // Activity lists it under Today, without a "spent" total.
  await page.goto('/activity')
  await expect(page).toHaveURL(`${WEB_URL}/activity`)
  const today = page.getByRole('heading', { level: 3, name: /^Today/ })
  await expect(today).toBeVisible()
  await expect(page.getByText(/spent$/)).toHaveCount(0)
  const undo = page.getByRole('button', { name: 'Undo' })

  if (isCompact(page)) {
    const row = page.getByRole('link', { name: /Transfer from ING Card to Cash/ })
    await expect(row).toContainText('Transfer · ATM')
    await expect(row).toContainText(/200,00\slei/)

    // Detail screen → Delete Transfer → Undo.
    await row.click()
    await expect(page.getByRole('heading', { level: 1, name: 'ING Card → Cash' })).toBeVisible()
    const deleted = deleteRequest(page)
    await page.getByRole('button', { name: 'Delete Transfer' }).click()
    await deleted
    await expect(page).toHaveURL(`${WEB_URL}/activity`)
    await expect(page.getByText('Transfer deleted')).toBeVisible()
    await expect(row).toBeHidden()
    await undo.click()
    await expect(row).toBeVisible()
  } else {
    const table = page.getByRole('listbox', { name: 'Transactions' })
    const row = table.getByRole('option', { name: 'Transfer from ING Card to Cash' })
    await expect(row).toContainText(/200,00\slei/)

    // Select it: the inspector shows the transfer; ⌫ deletes → Undo.
    await row.click()
    const inspector = page.getByRole('complementary', { name: 'Transfer details' })
    await expect(inspector).toContainText('ATM')
    const deleted = deleteRequest(page)
    await page.keyboard.press('Delete')
    await deleted
    await expect(page.getByText('Transfer deleted')).toBeVisible()
    await expect(row).toBeHidden()
    await undo.click()
    await expect(row).toBeVisible()
  }

  // The Expenses filter leaves transfers out.
  await page.goto('/activity?kind=expense')
  await expect(page.getByText('No Transactions')).toBeVisible()
})
