import { test, expect } from '@playwright/test'

test.describe('K8s — UI', () => {
  test('P0: navigate to K8s — Cluster Overview heading visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await expect(page.locator('text=Cluster Overview').first()).toBeVisible({ timeout: 8000 })
  })

  test('P0: stat cards — Total Nodes, Namespaces, Running Pods, Failing Pods', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await page.locator('text=Cluster Overview').first().waitFor({ timeout: 8000 })
    await expect(page.locator('text=Total Nodes').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Namespaces').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Running Pods').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Failing Pods').first()).toBeVisible({ timeout: 5000 })
  })

  test('P1: Namespaces table heading visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await page.locator('text=Cluster Overview').first().waitFor({ timeout: 8000 })
    await expect(page.locator('text=Status').first()).toBeVisible({ timeout: 5000 })
  })

  test('P1: Workloads section visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=K8s').first().click()
    await page.locator('text=Cluster Overview').first().waitFor({ timeout: 8000 })
    await expect(page.locator('text=Workloads').first()).toBeVisible({ timeout: 5000 })
  })
})
