import { setAuthCookie } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('K8s — UI', () => {
  test('P0: navigate to K8s — cluster view loaded', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await expect(
      page.locator('text=Cluster Overview').or(page.locator('text=No K8s cluster')).first()
    ).toBeVisible({ timeout: 8000 })
  })

  test('P0: stat cards or empty state visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await expect(
      page.locator('text=Cluster Overview').or(page.locator('text=No K8s cluster')).first()
    ).toBeVisible({ timeout: 8000 })
    const connected = await page.locator('text=Cluster Overview').isVisible().catch(() => false)
    if (connected) {
      await expect(page.locator('text=Total Nodes').first()).toBeVisible({ timeout: 5000 })
      await expect(page.locator('text=Running Pods').first()).toBeVisible({ timeout: 5000 })
    } else {
      await expect(page.locator('text=No K8s cluster').first()).toBeVisible({ timeout: 3000 })
    }
  })

  test('P1: Namespaces section or empty state visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await expect(
      page.locator('text=Cluster Overview').or(page.locator('text=No K8s cluster')).first()
    ).toBeVisible({ timeout: 8000 })
    await expect(
      page.locator('text=Status').or(page.locator('text=Connect a connector')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Workloads section or empty state visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await expect(
      page.locator('text=Cluster Overview').or(page.locator('text=No K8s cluster')).first()
    ).toBeVisible({ timeout: 8000 })
    await expect(
      page.locator('text=Workloads').or(page.locator('text=Connect a connector')).first()
    ).toBeVisible({ timeout: 5000 })
  })
})
