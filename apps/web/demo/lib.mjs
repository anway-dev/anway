// Shared harness: launch, auth, overlay layer (title cards + captions), fake
// cursor, and cinematic move-and-click helpers. Everything renders in-browser
// so a single continuous webm carries the whole story (no post-hoc concat).
import { chromium } from '@playwright/test'
import { execSync } from 'node:child_process'

export const WEB = process.env.WEB ?? 'http://localhost:8500'
export const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8510'
export const W = 1920, H = 1080

// Anway palette (matches CLAUDE.md design language).
export const C = {
  bg: '#080808', green: '#10b981', text: '#e5e5e5', sub: '#888', border: '#1a1a1a',
}

export function getToken() {
  const out = execSync(
    `docker exec infra-gateway-1 sh -c 'curl -s -XPOST http://localhost:8510/api/auth/login -H "Content-Type: application/json" -d "{\\"email\\":\\"admin@demo.anway.dev\\",\\"password\\":\\"E2ETestPassword2026!\\"}"'`,
  ).toString()
  return JSON.parse(out).token
}

// Injected on every document: overlay layer + fake cursor + control API on
// window.__demo. Kept dependency-free and idempotent.
export const initScript = () => {
  if (window.__demo) return
  const D = document
  const layer = D.createElement('div')
  layer.id = '__demo_layer'
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:Arial,Helvetica,sans-serif'
  const style = D.createElement('style')
  style.textContent = `
    @keyframes demoRipple {from{transform:translate(-50%,-50%) scale(0);opacity:.55}to{transform:translate(-50%,-50%) scale(1);opacity:0}}
    #__demo_cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483600;pointer-events:none;transition:left .62s cubic-bezier(.22,.61,.36,1),top .62s cubic-bezier(.22,.61,.36,1);filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
    #__demo_caption{position:fixed;left:44px;bottom:44px;max-width:60%;padding:14px 20px;background:rgba(10,10,10,.82);border:1px solid rgba(16,185,129,.35);border-left:3px solid #10b981;border-radius:8px;color:#e5e5e5;font-size:22px;line-height:1.35;letter-spacing:.2px;opacity:0;transform:translateY(10px);transition:opacity .5s ease,transform .5s ease;backdrop-filter:blur(6px)}
    #__demo_caption b{color:#10b981;font-weight:600}
    #__demo_title{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(1200px 600px at 50% 40%,#0e0e0e 0%,#080808 70%);opacity:0;transition:opacity .7s ease;text-align:center}
    #__demo_title .kick{color:#10b981;font-size:15px;letter-spacing:.42em;text-transform:uppercase;font-weight:600}
    #__demo_title .h{color:#f5f5f5;font-size:64px;font-weight:700;letter-spacing:-1px;line-height:1.05;max-width:1200px}
    #__demo_title .s{color:#888;font-size:26px;font-weight:400;max-width:900px;line-height:1.4}
    #__demo_title .cta{margin-top:14px;color:#10b981;font-size:20px;border:1px solid rgba(16,185,129,.4);padding:10px 22px;border-radius:6px}
    #__demo_wipe{position:fixed;inset:0;z-index:2147483400;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:radial-gradient(1400px 700px at 50% 42%,#0d0d0d 0%,#060606 72%);opacity:0;transition:opacity .55s cubic-bezier(.4,0,.2,1);text-align:center}
    #__demo_wipe .bar{width:0;height:2px;background:linear-gradient(90deg,transparent,#10b981,transparent);transition:width .6s ease .15s}
    #__demo_wipe.on .bar{width:220px}
    #__demo_wipe .up{color:#10b981;font-size:13px;letter-spacing:.44em;text-transform:uppercase;font-weight:600;opacity:0;transform:translateY(8px);transition:opacity .5s ease .1s,transform .5s ease .1s}
    #__demo_wipe .wh{color:#f2f2f2;font-size:46px;font-weight:700;letter-spacing:-.5px;line-height:1.12;max-width:1100px;opacity:0;transform:translateY(10px);transition:opacity .55s ease .18s,transform .55s ease .18s}
    #__demo_wipe .ws{color:#8a8a8a;font-size:21px;font-weight:400;max-width:820px;line-height:1.45;opacity:0;transform:translateY(10px);transition:opacity .55s ease .26s,transform .55s ease .26s}
    #__demo_wipe.on .up,#__demo_wipe.on .wh,#__demo_wipe.on .ws{opacity:1;transform:translateY(0)}
    #__demo_feat{position:fixed;inset:0;z-index:2147483450;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:radial-gradient(1400px 760px at 50% 42%,#0d0d0d 0%,#060606 74%);opacity:0;transition:opacity .6s ease;text-align:center;padding:60px}
    #__demo_feat .fk{color:#10b981;font-size:13px;letter-spacing:.42em;text-transform:uppercase;font-weight:600}
    #__demo_feat .fh{color:#f2f2f2;font-size:40px;font-weight:700;letter-spacing:-.5px;margin-bottom:14px}
    #__demo_feat .fg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;max-width:1180px}
    #__demo_feat .fi{border:1px solid #1e1e1e;background:#0c0c0c;border-radius:8px;padding:14px 16px;text-align:left;display:flex;align-items:center;gap:10px}
    #__demo_feat .fi .dot{width:7px;height:7px;border-radius:50%;background:#10b981;flex-shrink:0;box-shadow:0 0 6px rgba(16,185,129,.6)}
    #__demo_feat .fi span{color:#cfcfcf;font-size:15px}
  `
  D.documentElement.appendChild(style)
  const cursor = D.createElement('div')
  cursor.id = '__demo_cursor'
  cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M2 2 L2 17 L6.5 12.8 L9.4 19 L12 17.8 L9.1 11.7 L15 11.5 Z" fill="#fff" stroke="#0a0a0a" stroke-width="1.2"/></svg>`
  cursor.style.left = (window.innerWidth * 0.5) + 'px'
  cursor.style.top = (window.innerHeight * 0.55) + 'px'
  const cap = D.createElement('div'); cap.id = '__demo_caption'
  const title = D.createElement('div'); title.id = '__demo_title'
  const wipe = D.createElement('div'); wipe.id = '__demo_wipe'
  wipe.innerHTML = `<div class="up"></div><div class="bar"></div><div class="wh"></div><div class="ws"></div>`
  const feat = D.createElement('div'); feat.id = '__demo_feat'
  layer.appendChild(cap); layer.appendChild(title); layer.appendChild(wipe); layer.appendChild(feat)
  D.documentElement.appendChild(layer)
  D.documentElement.appendChild(cursor)

  window.__demo = {
    cursorTo(x, y) { cursor.style.left = x + 'px'; cursor.style.top = y + 'px' },
    hideCursor() { cursor.style.opacity = '0' },
    showCursor() { cursor.style.opacity = '1' },
    ripple(x, y) {
      const r = D.createElement('div')
      r.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:46px;height:46px;border-radius:50%;background:#10b981;z-index:2147483500;pointer-events:none;animation:demoRipple .6s ease-out forwards`
      D.documentElement.appendChild(r); setTimeout(() => r.remove(), 650)
    },
    caption(html) { cap.innerHTML = html; cap.style.opacity = '1'; cap.style.transform = 'translateY(0)' },
    clearCaption() { cap.style.opacity = '0'; cap.style.transform = 'translateY(10px)' },
    title(kick, h, s, cta) {
      title.innerHTML = (kick ? `<div class="kick">${kick}</div>` : '') +
        `<div class="h">${h}</div>` + (s ? `<div class="s">${s}</div>` : '') +
        (cta ? `<div class="cta">${cta}</div>` : '')
      title.style.opacity = '1'
    },
    hideTitle() { title.style.opacity = '0' },
    // Transition slide ("up next"): fade a dark card over the screen with a
    // forward-looking headline, so the viewer is told what's coming before it
    // appears (not a screen recording — a guided walkthrough).
    slideIn(up, h, s) {
      wipe.querySelector('.up').textContent = up || 'Up next'
      wipe.querySelector('.wh').innerHTML = h || ''
      wipe.querySelector('.ws').innerHTML = s || ''
      wipe.style.opacity = '1'; wipe.classList.add('on')
    },
    slideOut() { wipe.style.opacity = '0'; wipe.classList.remove('on') },
    covered() { return wipe.style.opacity === '1' },
    features(kick, h, items) {
      feat.innerHTML = `<div class="fk">${kick}</div><div class="fh">${h}</div>` +
        `<div class="fg">${items.map(i => `<div class="fi"><span class="dot"></span><span>${i}</span></div>`).join('')}</div>`
      feat.style.opacity = '1'
    },
    hideFeatures() { feat.style.opacity = '0' },
  }
}

export async function launch(outDir) {
  const browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb'] })
  const context = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: W, height: H } },
    colorScheme: 'dark',
  })
  const token = getToken()
  await context.addCookies([{ name: 'anway_token', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }])
  await context.addInitScript(initScript)
  const page = await context.newPage()
  return { browser, context, page }
}

// re-inject overlay after client navigations that may have blown it away
export async function ensureLayer(page) {
  await page.evaluate(`(${initScript.toString()})()`).catch(() => {})
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export async function title(page, kick, h, s, cta, holdMs = 3400) {
  await ensureLayer(page)
  await page.evaluate(([k, hh, ss, c]) => window.__demo.title(k, hh, ss, c), [kick, h, s, cta])
  await sleep(holdMs)
  await page.evaluate(() => window.__demo.hideTitle())
  await sleep(700)
}

export async function caption(page, html) {
  await ensureLayer(page)
  await page.evaluate(h => window.__demo.caption(h), html)
}
export async function clearCaption(page) {
  await page.evaluate(() => window.__demo?.clearCaption()).catch(() => {})
}

// Move fake cursor to element center, settle, ripple + real click.
export async function moveClick(page, locator, { click = true, settle = 700 } = {}) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator
  await el.scrollIntoViewIfNeeded().catch(() => {})
  const box = await el.boundingBox()
  if (!box) return false
  const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2)
  await ensureLayer(page)
  await page.evaluate(([X, Y]) => window.__demo.cursorTo(X, Y), [x, y])
  await sleep(settle)
  if (click) {
    await page.evaluate(([X, Y]) => window.__demo.ripple(X, Y), [x, y])
    await el.click({ timeout: 5000 }).catch(() => {})
  }
  return true
}

export async function nav(page, label) {
  const btn = page.locator('nav button', { hasText: label }).first()
  await moveClick(page, btn)
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await ensureLayer(page)
}

// Slide/setState helpers.
export async function slideIn(page, up, h, s) {
  await ensureLayer(page)
  await page.evaluate(([u, hh, ss]) => window.__demo.slideIn(u, hh, ss), [up, h, s])
}
export async function slideOut(page) {
  await page.evaluate(() => window.__demo?.slideOut()).catch(() => {})
}
export async function hideCursor(page) { await page.evaluate(() => window.__demo?.hideCursor()).catch(() => {}) }
export async function showCursor(page) { await page.evaluate(() => window.__demo?.showCursor()).catch(() => {}) }

// Full-screen feature summary card (the "everything in one surface" slide).
export async function featuresSlide(page, kick, h, items, holdMs = 4200) {
  await ensureLayer(page)
  await hideCursor(page)
  await page.evaluate(([k, hh, it]) => window.__demo.features(k, hh, it), [kick, h, items])
  await sleep(holdMs)
  await page.evaluate(() => window.__demo.hideFeatures())
  await sleep(650)
}

// Professional segue between screens: fade a dark "Up next" slide over the
// current screen, switch views UNDER the cover (so no half-loaded fl: the
// viewer never sees the swap), wait for the destination to settle, then reveal.
// `read` = how long the slide is held so it's actually readable.
export async function segue(page, { up = 'Up next', h, s, navLabel, read = 1900, after = 700, prep } = {}) {
  await slideIn(page, up, h, s)
  await sleep(read)
  // switch views while covered
  await hideCursor(page)
  if (navLabel) {
    await page.locator('nav button', { hasText: navLabel }).first().click({ timeout: 8000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 9000 }).catch(() => {})
  }
  if (prep) { await prep().catch(() => {}) }
  await sleep(after)                 // let the destination render behind the cover
  await ensureLayer(page)
  await slideOut(page)               // reveal
  await sleep(650)
  await showCursor(page)
}

// Wait until an element matching `selector` has meaningful text (used to hold
// on a result until it has actually arrived — never cut away pre-result).
export async function waitText(page, selector, { min = 40, timeout = 20000 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const len = await page.evaluate((sel) => {
      const els = Array.from(document.querySelectorAll(sel))
      return els.reduce((m, e) => Math.max(m, (e.textContent || '').trim().length), 0)
    }, selector).catch(() => 0)
    if (len >= min) return true
    await sleep(400)
  }
  return false
}

// Smoothly scroll a container/window and dwell.
export async function scrollSmooth(page, dy, steps = 20) {
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await sleep(45) }
}
