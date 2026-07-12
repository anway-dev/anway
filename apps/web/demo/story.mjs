// Full storyboard. Incident spine (Signals → orchestrator trace → war room →
// gated action), then a breadth montage across the platform. All overlays are
// in-browser (title cards, captions, cursor), so the recorded webm is the
// finished visual — ffmpeg only transcodes + adds the audio bed afterward.
import { launch, title, caption, clearCaption, nav, moveClick, sleep, ensureLayer, WEB } from './lib.mjs'

const OUT = new URL('./out', import.meta.url).pathname

async function scrollSmooth(page, dy, steps = 18) {
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(40) }
}
async function wander(page, x, y) { await ensureLayer(page); await page.evaluate(([X, Y]) => window.__demo.cursorTo(X, Y), [x, y]); await sleep(650) }

const { browser, context, page } = await launch(OUT)
try {
  await page.goto(WEB, { waitUntil: 'networkidle' })
  await sleep(700)

  // ── 1. Opening title ───────────────────────────────────────────────
  await title(page, 'Anway',
    'One surface for your<br>whole software org',
    'GitHub · Datadog · Kubernetes · Linear · ArgoCD — one nervous system', null, 3600)

  // ── 2. Signals ─────────────────────────────────────────────────────
  await nav(page, 'Signals')
  await sleep(600)
  await caption(page, 'One signal fires — <b>everyone sees the same truth</b>')
  await wander(page, 620, 210)
  await sleep(1600)
  await wander(page, 760, 300)
  await sleep(1800)
  await clearCaption(page); await sleep(400)

  // ── 3. Orchestrator: ask once, watch it trace ──────────────────────
  await nav(page, 'Anway')
  await sleep(700)
  await caption(page, 'Ask once — <b>Anway traces it across every connector</b>')
  const input = page.getByPlaceholder(/ask anway anything/i).first()
  await moveClick(page, input)
  await input.type("What's firing right now, and what's the root cause?", { delay: 34 })
  await sleep(500)
  await page.keyboard.press('Enter')
  // live execution trace streams in — let it play
  await sleep(9000)
  await clearCaption(page); await sleep(300)
  await caption(page, '<b>Root cause, grounded in live data</b> — cited, timestamped, no guesswork')
  await scrollSmooth(page, 700)
  await sleep(3500)
  await clearCaption(page); await sleep(400)

  // ── 4. War Room ────────────────────────────────────────────────────
  await nav(page, 'War Room')
  await sleep(900)
  await caption(page, 'The <b>war room assembles itself</b> — timeline, metrics, deploys, PRs')
  await scrollSmooth(page, 500)
  await sleep(2600)
  await scrollSmooth(page, 600)
  await sleep(2600)
  await clearCaption(page); await sleep(300)
  await caption(page, 'Recommended action — <b>gated</b>. You confirm before anything runs')
  await scrollSmooth(page, -400)
  await sleep(3200)
  await clearCaption(page); await sleep(400)

  // ── 5. Mid title ───────────────────────────────────────────────────
  await title(page, null, 'One nervous system.<br>Every tool.', 'Every connector added = more intelligence for the whole org', null, 3200)

  // ── 6. Breadth montage ─────────────────────────────────────────────
  const montage = [
    ['Services', 'Every service — its <b>dependency graph, owners, health</b>', 3200],
    ['Pipeline', '<b>Pipelines and gates</b> — configurable approvals per team', 3000],
    ['Cloud', 'Cloud health across <b>AWS · GCP · Azure</b>', 3000],
    ['K8s', 'Kubernetes clusters — <b>live</b>', 2800],
    ['Connectors', '<b>35+ connectors.</b> More context with every one', 3200],
    ['Audit', 'Every action, every user — <b>immutably logged</b>', 3000],
  ]
  for (const [label, cap, hold] of montage) {
    await nav(page, label)
    await sleep(700)
    await caption(page, cap)
    await wander(page, 700 + Math.random() * 500, 300 + Math.random() * 200)
    await sleep(hold)
    await clearCaption(page); await sleep(280)
  }

  // ── 7. Close ───────────────────────────────────────────────────────
  await title(page, 'Anway',
    'Ask once. See everything.<br>Act with confidence.',
    'The central nervous system of your software organisation', 'anway.dev', 4600)

  await sleep(500)
} finally {
  await context.close(); await browser.close()
}
console.log('capture complete')
