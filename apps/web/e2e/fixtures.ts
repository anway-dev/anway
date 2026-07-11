import type { APIRequestContext, BrowserContext } from '@playwright/test'

export const GATEWAY = 'http://127.0.0.1:8510'
export const WEB = 'http://localhost:8500'
export const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'
export const DEMO_EMAIL = 'admin@demo.anway.dev'

// The real /api/auth/login route has its own strict anti-brute-force rate
// limit (5 req/min per IP, apps/gateway/src/routes/auth.ts) — a legitimate
// production security control, not something to weaken for tests. But every
// spec file's own beforeAll independently calls getToken2/getToken3, and with
// workers=1 the whole suite runs in one process — so cache each token at
// module scope and only actually hit the login/demo endpoints once per real
// run. Confirmed live: without this, a full suite run exhausts the 5/min
// budget partway through and every later file's login silently returns
// {error: 'too many requests...'} (no token field), cascading into 400/401s
// that look like gate/RBAC bugs but are actually just this rate limit.
let cachedToken: string | undefined
let cachedToken2: string | undefined
let cachedToken3: string | undefined

const E2E_DEFAULT_PASSWORD = 'E2ETestPassword2026!'

// Auth for the admin fixture user. Prefers demo login when DEMO_MODE=true;
// falls back to real password login (admin@demo.anway.dev, seeded with a
// password_hash) when demo is disabled — so the suite works in BOTH modes.
export async function getToken(request: APIRequestContext): Promise<string> {
  if (cachedToken !== undefined) return cachedToken
  const r = await request.post(`${GATEWAY}/api/auth/demo`)
  if (r.ok()) {
    const body = await r.json() as { token?: string }
    if (body.token) { cachedToken = body.token; return cachedToken }
  }
  // Demo disabled (404) — log in as the seeded admin with the test password.
  cachedToken = await loginAs(request, DEMO_EMAIL, E2E_DEFAULT_PASSWORD)
  return cachedToken
}

// For multi-role tests: login as a seeded user with a known password
// Seed must have created the user with password_hash before tests run
async function loginAs(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post(`${GATEWAY}/api/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  })
  const body = await r.json() as { token?: string }
  return body.token ?? ''
}

// Default password matches prisma/seed.ts's E2E_TEST_PASSWORD_HASH for these
// exact seeded users — without SEED_DEMO=true having run, login correctly
// 401s and these helpers return an empty token (same as before), but against
// a demo-seeded DB this now actually authenticates instead of always failing.

export async function getToken2(request: APIRequestContext): Promise<string> {
  if (cachedToken2 !== undefined) return cachedToken2
  cachedToken2 = await loginAs(request, process.env['E2E_USER2_EMAIL'] ?? 'sre@demo.anway.dev', process.env['E2E_USER2_PASSWORD'] ?? E2E_DEFAULT_PASSWORD)
  return cachedToken2
}

export async function getToken3(request: APIRequestContext): Promise<string> {
  if (cachedToken3 !== undefined) return cachedToken3
  cachedToken3 = await loginAs(request, process.env['E2E_USER3_EMAIL'] ?? 'dev@demo.anway.dev', process.env['E2E_USER3_PASSWORD'] ?? E2E_DEFAULT_PASSWORD)
  return cachedToken3
}

export async function authHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await getToken(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function authHeaders2(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await getToken2(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function authHeaders3(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await getToken3(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Set auth cookie on browser context — uses demo login. */
export async function setAuthCookie(context: BrowserContext): Promise<void> {
  const token = await getToken(context.request)
  if (token) {
    await context.addCookies([{
      name: 'anway_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax' as const,
    }])
  }
}

export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (result: T) => boolean,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  const interval = opts.intervalMs ?? 300
  const timeout = opts.timeoutMs ?? 5000
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await fn()
    if (predicate(result)) return result
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error(`pollUntil timed out after ${timeout}ms`)
}

export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
