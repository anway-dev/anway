import { setAuthCookie } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('Intake / Routing — UI', () => {
  test('P0: navigate to Routing — L1 Assist mode visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Routing').first().click()
    await expect(page.locator('text=L1 Assist').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: routing mode options visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Routing').first().click()
    await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
    const modeCount = await page.locator('button').filter({ hasText: /bypass|L1|Assist|route/i }).count()
    expect(modeCount).toBeGreaterThanOrEqual(1)
  })

  test('P1: L1 Assist shows triage description', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Routing').first().click()
    await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
    await page.locator('text=L1 Assist').first().click()
    await expect(
      page.locator('text=triage').or(page.locator('text=context')).or(page.locator('text=Anvay')).first()
    ).toBeVisible({ timeout: 3000 })
  })
})

test('P1: Routing mode click updates description', async ({ page }) => {
  await setAuthCookie(page.context())
  await page.goto('/')
  await page.locator('text=Routing').first().click()
  await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
  const bypassBtn = page.locator('button').filter({ hasText: /bypass/i }).first()
  if (await bypassBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await bypassBtn.click()
    await expect(
      page.locator('text=bypass').or(page.locator('text=auto')).first()
    ).toBeVisible({ timeout: 3000 })
  }
})

test('P1: no JS errors on Routing load', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await setAuthCookie(page.context())
  await page.goto('/')
  await page.locator('text=Routing').first().click()
  await page.locator('text=L1 Assist').first().waitFor({ timeout: 8000 })
  expect(errors).toHaveLength(0)
})
