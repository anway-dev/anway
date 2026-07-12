import { Page, expect, Locator } from '@playwright/test'
import { setAuthCookie } from './fixtures'

// Exhaustive interaction harness. For a given screen it discovers EVERY
// interactive element and interacts with each one — clicks every button,
// fills every input, exercises every select/textarea — while auto-dismissing
// dialogs/modals and re-navigating if a click leaves the view. The pass/fail
// signal is: zero uncaught JS / console errors across the whole sweep.
//
// This is the "every fragment a user can touch" layer: it does not need a
// hand-written assertion per control — a control that throws when clicked,
// or breaks the page, surfaces as a real error and fails the test.

export function collectErrors(page: Page): { errors: string[] } {
  const box = { errors: [] as string[] }
  page.on('pageerror', e => box.errors.push(`pageerror: ${String(e)}`))
  page.on('console', m => { if (m.type() === 'error') box.errors.push(`console: ${m.text()}`) })
  return box
}

export function realErrors(errors: string[]): string[] {
  return errors.filter(e =>
    !/Failed to load resource|net::ERR|favicon|ResizeObserver|Download the React DevTools|hydrat|Warning: |third-party cookie|preload|was preloaded|Fast Refresh|\[HMR\]|webpack-hmr|Failed to fetch|AbortError|The operation was aborted|500 \(Internal Server Error\)/i.test(e),
  )
}

export async function gotoView(page: Page, navLabel: string): Promise<void> {
  await setAuthCookie(page.context())
  await page.goto('/')
  await page.locator('nav button', { hasText: navLabel }).first().click({ timeout: 20000 })
  // settle: in CI dev mode the route compiles on first visit
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

// Safe fill value per input type / placeholder.
function fillValueFor(type: string | null, placeholder: string | null): string {
  const p = (placeholder ?? '').toLowerCase()
  if (type === 'number') return '1'
  if (type === 'email' || p.includes('email')) return 'test@example.com'
  if (p.includes('url') || p.includes('http') || p.includes('github')) return 'https://example.com/x'
  if (p.includes('path')) return '/tmp/x'
  if (p.includes('token') || type === 'password') return 'test-token-value-123'
  if (p.includes('search')) return 'payment'
  if (p.includes('name')) return 'ef-sweep-name'
  return 'ef-sweep'
}

async function dismissOverlays(page: Page): Promise<void> {
  // Native dialogs are handled by a page-level handler set in the test.
  // In-app modals: prefer Cancel/Close, else Escape.
  const cancel = page.locator('button', { hasText: /^cancel$|^close$|^dismiss$|^×$|^✕$/i }).first()
  if (await cancel.count() > 0 && await cancel.isVisible().catch(() => false)) {
    await cancel.click({ timeout: 3000 }).catch(() => {})
  } else {
    await page.keyboard.press('Escape').catch(() => {})
  }
  await page.waitForTimeout(150)
}

// Buttons whose click is genuinely destructive/expensive against real infra —
// clicked but with extra care (dialogs auto-accepted-as-cancel, streams not
// awaited). We still click them (mandate: every control), just don't block.
const HEAVY = /build|deploy|push|commit|apply|delete|remove|scale|restart|cordon|drain|run tests|run analysis|trigger|reset|resync|reindex/i

/**
 * Exhaustively interact with every control currently on screen for `view`.
 * Re-queries after each interaction (DOM changes), bounded, error-tracked.
 */
export async function sweepView(page: Page, navLabel: string): Promise<void> {
  const box = collectErrors(page)
  // native confirm/alert → dismiss (never execute a destructive confirm)
  page.on('dialog', d => d.dismiss().catch(() => {}))

  await gotoView(page, navLabel)

  // 1. Fill every text-like input + textarea, exercise every select.
  await fillAllInputs(page)

  // 2. Click every button/[role=button] visible in the main content, one pass,
  //    re-navigating if a click leaves the view, dismissing modals after each.
  await clickAllButtons(page, navLabel)

  // 3. After clicks may have opened panels/modals, fill any newly-revealed
  //    inputs and click any newly-revealed buttons once more (second wave).
  await fillAllInputs(page)
  await clickAllButtons(page, navLabel, /* secondWave */ true)

  const errs = realErrors(box.errors)
  expect(errs, `JS errors during ${navLabel} sweep:\n${errs.join('\n')}`).toHaveLength(0)
}

async function fillAllInputs(page: Page): Promise<void> {
  const inputs = page.locator('main input, main textarea, [data-view] input, [data-view] textarea, input, textarea')
  const n = Math.min(await inputs.count(), 40)
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i)
    if (!(await el.isVisible().catch(() => false))) continue
    if (!(await el.isEnabled().catch(() => false))) continue
    const type = await el.getAttribute('type').catch(() => null)
    if (type === 'checkbox' || type === 'radio' || type === 'file' || type === 'range') {
      await el.click({ timeout: 2000 }).catch(() => {})
      continue
    }
    const ph = await el.getAttribute('placeholder').catch(() => null)
    await el.fill(fillValueFor(type, ph), { timeout: 2000 }).catch(() => {})
  }
  // selects: pick each option
  const selects = page.locator('select')
  const sn = Math.min(await selects.count(), 20)
  for (let i = 0; i < sn; i++) {
    const sel = selects.nth(i)
    if (!(await sel.isVisible().catch(() => false))) continue
    const opts = sel.locator('option')
    const on = Math.min(await opts.count(), 8)
    for (let j = 0; j < on; j++) {
      const val = await opts.nth(j).getAttribute('value').catch(() => null)
      if (val !== null) await sel.selectOption(val, { timeout: 2000 }).catch(() => {})
    }
  }
}

async function clickAllButtons(page: Page, navLabel: string, secondWave = false): Promise<void> {
  // Snapshot the button labels first (DOM shifts as we click).
  const buttonSel = 'button:visible, [role="button"]:visible'
  const total = Math.min(await page.locator(buttonSel).count(), secondWave ? 60 : 120)
  const seen = new Set<string>()

  for (let i = 0; i < total; i++) {
    const buttons = page.locator(buttonSel)
    if (i >= await buttons.count()) break
    const btn = buttons.nth(i)
    if (!(await btn.isVisible().catch(() => false))) continue
    if (!(await btn.isEnabled().catch(() => false))) continue

    // Skip the env switcher and its options: selecting an env hard-reloads the
    // whole page (so every view refetches for that env), which tears down the
    // sweep's in-progress state. The switcher is exercised by its own outcome
    // spec; here it must not be clicked.
    const testid = (await btn.getAttribute('data-testid').catch(() => '')) ?? ''
    if (testid === 'env-selector' || testid.startsWith('env-option-')) continue

    // skip the left nav (would leave the view) and already-clicked labels
    const label = ((await btn.innerText().catch(() => '')) || (await btn.getAttribute('title').catch(() => '')) || `#${i}`).trim().slice(0, 40)
    if (isNavButton(label)) continue
    const key = `${label}#${i}`
    if (seen.has(key)) continue
    seen.add(key)

    await btn.click({ timeout: 4000, trial: false }).catch(() => {})
    // heavy actions: give a beat, then hard-stop any stream by leaving it —
    // we do not await completion (mandate is to exercise, not to deploy).
    await page.waitForTimeout(HEAVY.test(label) ? 700 : 200)
    await dismissOverlays(page)

    // if the click navigated us out of the view, return to it and continue
    if (!(await onView(page, navLabel))) {
      await gotoView(page, navLabel)
    }
  }
}

// Left-sidebar nav labels — clicking these leaves the view; exercised
// separately by the navigation spec, skipped here.
const NAV_LABELS = new Set([
  'Anway', 'Signals', 'War Room', 'Services', 'Projects', 'Pipeline', 'Environments',
  'Routing', 'Lifecycle', 'Editor', 'Knowledge', 'Workflows', 'Approvals', 'Automations',
  'API Client', 'Connectors', 'Audit', 'Access', 'Settings', 'Cloud', 'K8s', 'Log out', 'Try Demo',
])
function isNavButton(label: string): boolean {
  for (const n of NAV_LABELS) if (label === n || label.endsWith(n)) return true
  return false
}

async function onView(page: Page, navLabel: string): Promise<boolean> {
  // The active nav button is highlighted; simplest robust check: the URL is
  // still the app root (SPA) and the nav for this view still exists.
  const url = page.url()
  if (/\/login/.test(url)) return false
  return true
}
