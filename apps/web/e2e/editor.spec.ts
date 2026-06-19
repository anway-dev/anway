import { test, expect } from '@playwright/test'
import { setAuthCookie } from './fixtures'

test.describe('Editor — UI', () => {
  test('P0: navigate to Editor — Problems panel visible', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await expect(page.locator('text=No problems detected').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: idle state panel visible', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=No problems detected').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Open a project').or(page.locator('text=payments')).or(page.locator('text=demo')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: no JS errors on editor load', async ({ page, context }) => {
    await setAuthCookie(context)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=No problems detected').first().waitFor({ timeout: 8000 })
    expect(errors).toHaveLength(0)
  })

  test('P1: Code area or file list visible', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=No problems detected').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Open a project').or(page.locator('text=payments')).or(page.locator('text=demo')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Analysis panel visible', async ({ page, context }) => {
    await setAuthCookie(context)
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=No problems detected').first().waitFor({ timeout: 8000 })
    await expect(page.locator('text=No problems detected').first()).toBeVisible({ timeout: 5000 })
  })
})
