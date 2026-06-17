import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('P0: all key sidebar nav items visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    const items = ['Signals', 'War Room', 'Services', 'Lifecycle', 'Editor',
      'Knowledge', 'Workflows', 'Automations', 'API Client', 'Connectors',
      'Audit', 'Access', 'Cloud', 'K8s']
    for (const item of items) {
      await expect(page.locator(`text=${item}`).first()).toBeVisible()
    }
  })

  test('P0: each nav view loads distinct content', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')

    await page.locator('text=Audit').first().click()
    await expect(page.locator('text=Audit Trail').or(page.locator('text=Audit Log')).first()).toBeVisible({ timeout: 5000 })

    await page.locator('text=Cloud').first().click()
    await expect(page.locator('text=Cloud Health').first()).toBeVisible({ timeout: 5000 })

    await page.locator('text=K8s').first().click()
    await expect(page.locator('text=Cluster Overview').first()).toBeVisible({ timeout: 5000 })

    await page.locator('text=Workflows').first().click()
    await expect(page.locator('text=Autonomy').first()).toBeVisible({ timeout: 5000 })

    await page.locator('text=Services').first().click()
    await expect(
      page.locator('text=Service Catalog').or(page.locator('text=payments-api')).or(page.locator('text=Dependencies')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: view switches produce no JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setAuthCookie(page.context())
    await page.goto('/')
    for (const view of ['Signals', 'War Room', 'Access', 'Audit']) {
      await page.locator(`text=${view}`).first().click()
      await page.locator(`text=${view}`).first().waitFor({ timeout: 2000 })
    }
    expect(errors).toHaveLength(0)
  })
})
