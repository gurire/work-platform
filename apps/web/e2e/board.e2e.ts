import { expect, test } from '@playwright/test'
import { ASHA, openAs, unique } from './helpers'

test('add an item on a team board, open it and move it to the next stage', async ({ page }) => {
  const title = unique('Check new district codes')
  await openAs(page, ASHA, '#/m/teams/DATA')

  const quickAdd = page.locator('.mx-column input').first()
  await quickAdd.fill(title)
  await quickAdd.press('Enter')
  const card = page.locator('.mx-card', { hasText: title })
  await expect(card).toBeVisible()

  await card.click()
  const panel = page.locator('.mx-detail')
  await expect(panel.getByLabel('Title')).toHaveValue(title)

  const move = panel.getByRole('button', { name: /^Move to / }).first()
  const target = ((await move.textContent()) ?? '').replace('Move to ', '').trim()
  await move.click()
  await expect(panel).toContainText(target)

  // The move survives a reload: it went through the API, not just the screen.
  await page.reload()
  await expect(
    page.locator('.mx-column', { hasText: target }).locator('.mx-card', { hasText: title }),
  ).toBeVisible()
})

test('search finds an item from the command palette', async ({ page }) => {
  await openAs(page, ASHA, '#/m/home')
  await page.keyboard.press('Control+k')
  const box = page.getByLabel('Search or type a command')
  await expect(box).toBeVisible()
  await box.fill('DATA-1')
  await expect(page.getByRole('listbox', { name: 'Results' })).toContainText('DATA-1')
})
