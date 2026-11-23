import { expect, test } from '@playwright/test'
import { ASHA, GRACE, KAVYA, openAs, unique } from './helpers'

test('a mention reaches the other person’s inbox', async ({ page }) => {
  const note = unique('Totals checked')
  await openAs(page, ASHA, '#/m/items/DATA-1')
  await expect(page.locator('.mx-detail')).toBeVisible()

  const box = page.getByLabel('Write a comment')
  await box.fill(`${note}, thanks @Gra`)
  await page.locator('.mx-mention-menu button', { hasText: 'Grace' }).first().click()
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.locator('.mx-detail')).toContainText(note)

  await openAs(page, GRACE, '#/m/inbox')
  await page.getByRole('tab', { name: 'Mentions' }).click()
  await expect(page.locator('main')).toContainText('mentioned you on')
  await expect(page.locator('main')).toContainText('DATA-1')
})

test('someone outside the team asks through a form and the team accepts it', async ({ page }) => {
  const formName = unique('Data pull')
  const ask = unique('School enrolment by block')

  // The team admin publishes a form.
  await openAs(page, GRACE, '#/m/settings/DATA')
  await page.getByRole('tab', { name: 'Request forms' }).click()
  await page.locator('.mx-settings-grid input.md-input').first().fill(formName)
  await page.getByLabel('Short introduction').fill('Ask the data team for an extract or a report.')
  await page.getByLabel('Question 1', { exact: true }).fill('Which dataset and years?')
  await page.getByRole('button', { name: 'Save form' }).click()
  await expect(page.locator('main')).toContainText(formName)

  // Someone else asks.
  await openAs(page, KAVYA, '#/m/requests')
  await page.locator('.mx-card', { hasText: formName }).click()
  await page.getByLabel('What do you need?').fill(ask)
  await page.getByLabel(/Which dataset and years/).fill('UDISE enrolment, 2019 to 2025')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.locator('main')).toContainText(ask)

  // The team accepts it, which makes a work item.
  await openAs(page, GRACE, '#/m/requests')
  await page.getByRole('tab', { name: /Triage · Data/ }).click()
  const row = page
    .locator('.md-card')
    .filter({ hasText: ask })
    .filter({ has: page.getByRole('button', { name: 'Accept', exact: true }) })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.locator('.md-card', { hasText: ask })).toContainText('Accepted')
  await openAs(page, GRACE, '#/m/teams/DATA')
  await expect(page.locator('.mx-card', { hasText: ask })).toBeVisible()
})
