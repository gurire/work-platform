import { expect, type Page } from '@playwright/test'

/** Sample people (packages/shared sample-data): user-1 Asha is the org admin, user-7 Grace runs Data. */
export const ASHA = 'user-1'
export const GRACE = 'user-7'
export const KAVYA = 'user-11'

/** Opens a Midnight page as a sample user (the dev sign-in reads the user from localStorage). */
export async function openAs(page: Page, user: string, hash: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ u, h }) => {
      localStorage.setItem('wm-dev-user', u)
      localStorage.setItem('wp.theme', 'dark')
      location.hash = h
    },
    { u: user, h: hash },
  )
  await page.reload()
  await expect(page.locator('[data-ui="midnight"]')).toBeVisible()
}

/** A title no other test or seed row will have. */
export const unique = (label: string): string => `${label} ${Date.now().toString(36)}`
