import { test, expect } from '@playwright/test'

test.describe('Editor — UI', () => {
  test('P0: navigate to Editor — Findings section visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await expect(page.locator('text=Findings').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: Gate section visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=Findings').first().waitFor({ timeout: 8000 })
    await expect(page.locator('text=Gate').first()).toBeVisible({ timeout: 5000 })
  })

  test('P1: no JS errors on editor load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=Findings').first().waitFor({ timeout: 8000 })
    expect(errors).toHaveLength(0)
  })

  test('P1: Code area or file list visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=Findings').first().waitFor({ timeout: 8000 })
    await expect(
      page.locator('text=Code').or(page.locator('text=File')).or(page.locator('text=pre')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Review section visible', async ({ page }) => {
    await page.goto('/')
    await page.locator('text=Editor').first().click()
    await page.locator('text=Findings').first().waitFor({ timeout: 8000 })
    await expect(page.locator('text=Review').first()).toBeVisible({ timeout: 5000 })
  })
})
