// Storyboard — a guided walkthrough, not a screen recording.
// Every screen is entered through a fade "Up next" slide (tells the viewer
// what's coming), interactions dwell on their RESULT before moving on, and the
// cursor is hidden during transitions. Incident spine → breadth montage.
import {
  launch, title, segue, moveClick, waitText, scrollSmooth, ensureLayer,
  slideOut, sleep, showCursor, featuresSlide, WEB, GATEWAY, getToken,
} from './lib.mjs'

const OUT = new URL('./out', import.meta.url).pathname
const HERO_SESSION = 'demo-hero-' + Date.now()
const HERO_QUERY = "What's firing right now, and what's the root cause?"

async function wander(page, x, y, dwell = 900) {
  await ensureLayer(page)
  await page.evaluate(([X, Y]) => window.__demo.cursorTo(X, Y), [x, y])
  await sleep(dwell)
}

// Pre-run the hero query through the real orchestrator (off-camera) so its
// genuine, multi-agent grounded answer is already saved to this session. In
// the video we then point the browser at this session — a real result appears
// instantly instead of a ~20s live-inference dead wait. Nothing is fabricated;
// it's the same query, same agents, same answer — just pre-computed.
async function prewarm() {
  const token = getToken()
  const r = await fetch(`${GATEWAY}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: HERO_QUERY, sessionId: HERO_SESSION }),
  })
  const reader = r.body.getReader()
  // drain to completion so the full answer is persisted
  for (;;) { const { done } = await reader.read(); if (done) break }
}

console.log('pre-warming hero session…')
await prewarm()
console.log('pre-warm done')

const { browser, context, page } = await launch(OUT)
try {
  await page.goto(WEB, { waitUntil: 'networkidle' })
  // point the orchestrator at the pre-warmed session before it is (re)mounted
  await page.evaluate((sid) => localStorage.setItem('anway-session-id', sid), HERO_SESSION)
  await sleep(700)

  // ── 1. Opening title ───────────────────────────────────────────────
  await title(page, 'Anway',
    'One surface for your<br>whole software org',
    'GitHub · Datadog · Kubernetes · Linear · ArgoCD — one nervous system', null, 3600)

  // ── 2. Signals ─────────────────────────────────────────────────────
  await segue(page, {
    up: 'The story starts', h: 'A signal fires',
    s: 'Everyone sees the same truth — no five-tabs-deep scramble',
    navLabel: 'Signals', read: 2100, after: 900,
  })
  await wander(page, 640, 220, 1500)   // read the top alert
  await wander(page, 780, 320, 1900)   // and the next — result is already on screen
  await sleep(600)

  // ── 3. Orchestrator — ask once, show the real grounded answer ──────
  await segue(page, {
    up: 'Ask once', h: 'Anway traces it across every connector',
    s: 'One question — graph first, then targeted calls to the right tools',
    navLabel: 'Anway', read: 2300, after: 900,
    // the pre-warmed session's real Q&A is loaded on mount
    prep: async () => { await waitText(page, '[data-testid="assistant-msg"]', { min: 120, timeout: 8000 }) },
  })
  await sleep(2400)                    // dwell on the question + grounded answer
  await scrollSmooth(page, 460)
  await sleep(2600)                    // read the cited, multi-agent result
  await scrollSmooth(page, 380)
  await sleep(1800)

  // ── 4. War Room ────────────────────────────────────────────────────
  await segue(page, {
    up: 'The trail', h: 'The war room assembles itself',
    s: 'Timeline, metrics, deploys and PRs — gathered around the incident',
    navLabel: 'War Room', read: 2200, after: 1100,
  })
  await sleep(800)
  await scrollSmooth(page, 480)
  await sleep(2400)
  await scrollSmooth(page, 560)
  await sleep(2400)
  await scrollSmooth(page, -420)
  await sleep(1800)

  // ── 5. Gated action title ──────────────────────────────────────────
  await title(page, 'Governed by design',
    'Recommended action —<br>you confirm before anything runs',
    'Every write gated · deterministic perimeter · fully audited', null, 3200)

  // ── 6. Breadth montage — only screens with real, populated data ────
  // Services — a real service detail
  await segue(page, {
    up: 'The whole map', h: 'Services', s: 'Every service — dependencies, owners, health',
    navLabel: 'Services', read: 1750, after: 900,
  })
  await wander(page, 360, 200, 900)     // hover a service in the catalog
  await sleep(2200)

  // Pipeline — select a real pipeline so its stages/gates fill the panel
  await segue(page, {
    up: 'Ship it', h: 'Pipelines & gates', s: 'Configurable approvals per team, stage by stage',
    navLabel: 'Pipeline', read: 1750, after: 900,
    prep: async () => {
      // wait for the list, then click a clean, populated pipeline (5 stages)
      await page.getByTestId('pipeline-row').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
      const byName = (re) => page.getByTestId('pipeline-row').filter({ hasText: re }).first()
      let row = byName(/payments-api-deploy/)
      if (!(await row.count())) row = byName(/auth-service-deploy/)
      await row.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
      await row.scrollIntoViewIfNeeded().catch(() => {})
      await row.click({ timeout: 5000 }).catch(() => {})
      // confirm the detail (stages) rendered before revealing
      await page.getByText(/Build & Test|Deploy to Production|Security Scan/i).first()
        .waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
    },
  })
  await sleep(2600)                      // dwell on the pipeline stages

  // Connectors — the compounding datasource grid (now all healthy)
  await segue(page, {
    up: 'It compounds', h: 'Connectors', s: '35+ datasources — each one adds context for the whole org',
    navLabel: 'Connectors', read: 1750, after: 900,
  })
  await wander(page, 700, 300, 1000)
  await sleep(1900)

  // Audit — the immutable trail
  await segue(page, {
    up: 'Nothing hidden', h: 'Audit', s: 'Every action, every user — immutably logged',
    navLabel: 'Audit', read: 1700, after: 900,
  })
  await sleep(2400)

  // ── 7. Everything else, one surface ────────────────────────────────
  await featuresSlide(page, 'One surface', 'Everything your org runs on', [
    'Orchestrator chat', 'Live signals & alerts', 'Incident war room', 'Service catalog',
    'Pipelines & gates', 'Knowledge graph', 'Autonomy workflows', 'Approvals',
    'Event automations', 'Cron monitors', '35+ connectors', 'Immutable audit',
    'Access perimeters', 'Cloud health', 'Kubernetes', 'PRD → deploy lifecycle',
  ], 4600)

  // ── 8. Close ───────────────────────────────────────────────────────
  await title(page, 'Anway',
    'Ask once. See everything.<br>Act with confidence.',
    'The central nervous system of your software organisation', 'anway.dev', 4800)

  await slideOut(page); await showCursor(page)
  await sleep(500)
} finally {
  await context.close(); await browser.close()
}
console.log('capture complete')
