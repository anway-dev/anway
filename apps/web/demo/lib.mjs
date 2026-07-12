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
  `
  D.documentElement.appendChild(style)
  const cursor = D.createElement('div')
  cursor.id = '__demo_cursor'
  cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M2 2 L2 17 L6.5 12.8 L9.4 19 L12 17.8 L9.1 11.7 L15 11.5 Z" fill="#fff" stroke="#0a0a0a" stroke-width="1.2"/></svg>`
  cursor.style.left = (window.innerWidth * 0.5) + 'px'
  cursor.style.top = (window.innerHeight * 0.55) + 'px'
  const cap = D.createElement('div'); cap.id = '__demo_caption'
  const title = D.createElement('div'); title.id = '__demo_title'
  layer.appendChild(cap); layer.appendChild(title)
  D.documentElement.appendChild(layer)
  D.documentElement.appendChild(cursor)

  window.__demo = {
    cursorTo(x, y) { cursor.style.left = x + 'px'; cursor.style.top = y + 'px' },
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
