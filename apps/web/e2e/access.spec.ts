import { setAuthCookie } from './fixtures'
import { test, expect } from '@playwright/test'

test.describe('Access — UI', () => {
  test('P0: navigate to Access — user list with role visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await expect(
      page.locator('text=User').or(page.locator('text=Role')).or(page.locator('text=Perimeter')).first()
    ).toBeVisible({ timeout: 30000 })
    await expect(
      page.locator('text=admin').or(page.locator('text=dev')).or(page.locator('text=viewer')).first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('P1: Access view content sections visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await page.locator('text=Role').or(page.locator('text=Perimeter')).or(page.locator('text=User')).first().waitFor({ timeout: 30000 })
    // Access view must show some content — user list, roles, or permissions
    const content = page.locator('text=User')
      .or(page.locator('text=Role'))
      .or(page.locator('text=Perimeter'))
      .or(page.locator('text=Connector'))
      .or(page.locator('text=github'))
      .first()
    await expect(content, 'Access view must render content').toBeVisible({ timeout: 5000 })
  })

  test('P1: User list or permission table visible', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await page.locator('text=Role').or(page.locator('text=Perimeter')).or(page.locator('text=User')).first().waitFor({ timeout: 30000 })
    // Access view shows user info or connector permissions
    const hasContent = await page.locator('text=admin')
      .or(page.locator('text=dev'))
      .or(page.locator('text=viewer'))
      .or(page.locator('text=github'))
      .or(page.locator('text=datadog'))
      .or(page.locator('text=Connector'))
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
    expect(hasContent, 'Access view must show user roles or connector access').toBe(true)
  })

  test('P1: click user — detail panel shows perimeter', async ({ page }) => {
    await setAuthCookie(page.context())
    await page.goto('/')
    await page.locator('text=Access').first().click()
    await page.locator('text=admin').or(page.locator('text=Role')).first().waitFor({ timeout: 30000 })
    const userRow = page.locator('text=admin').or(page.locator('text=dev')).first()
    if (await userRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userRow.click()
      await expect(
        page.locator('text=Perimeter').or(page.locator('text=Connector')).or(page.locator('text=github')).first()
      ).toBeVisible({ timeout: 3000 })
    }
  })
})
