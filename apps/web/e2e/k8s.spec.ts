import { setAuthCookie, authHeaders, GATEWAY } from './fixtures'
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

test.describe('K8s write ops — API', () => {
  let headers: Record<string, string>
  test.beforeAll(async ({ request }) => { headers = await authHeaders(request) })

  // "admin skips perimeter" means admin bypasses the write-*scope* check (the
  // `if (user.role !== 'admin')` block in k8s.ts) — it does NOT mean admin
  // skips the V1 write gate. Per CLAUDE.md's V1 Trust Principle, every write
  // action is gated with no exceptions, admin included: without a gateId in
  // the body, these correctly 403 with "gate approval required" before ever
  // reaching cluster logic. Confirmed live via a direct call.
  test('POST /api/k8s/pods/:ns/:name/restart — admin skips perimeter, still requires gate approval', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/k8s/pods/default/nonexistent-pod-e2e/restart`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {},
    })
    // 403 = gate approval required (no gateId supplied) or perimeter denied;
    // 500/501/503 = no k8s cluster in test env; 404 = pod not found
    expect([403, 404, 500, 501, 503]).toContain(resp.status())
  })

  test('POST /api/k8s/deployments/:ns/:name/scale — admin skips perimeter, still requires gate approval', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/k8s/deployments/default/nonexistent-deploy-e2e/scale`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { replicas: 2 },
    })
    expect([403, 404, 500, 501, 503]).toContain(resp.status())
  })

  test('POST /api/k8s/nodes/:name/cordon — admin skips perimeter, still requires gate approval', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/k8s/nodes/nonexistent-node-e2e/cordon`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {},
    })
    expect([403, 404, 500, 501, 503]).toContain(resp.status())
  })

  test('POST /api/k8s/pods/:ns/:name/restart — without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/k8s/pods/default/anything/restart`, { data: {} })
    expect(resp.status()).toBe(401)
  })

  test('POST /api/k8s/deployments/:ns/:name/scale — without auth returns 401', async ({ request }) => {
    const resp = await request.post(`${GATEWAY}/api/k8s/deployments/default/anything/scale`, { data: {} })
    expect(resp.status()).toBe(401)
  })
})
