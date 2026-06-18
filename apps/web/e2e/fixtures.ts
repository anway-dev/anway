import type { APIRequestContext, BrowserContext } from '@playwright/test'

export const GATEWAY = 'http://127.0.0.1:8510'
export const WEB = 'http://localhost:8500'
export const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'
export const DEMO_EMAIL = 'dev@anvay.local'

export async function getToken(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${GATEWAY}/api/auth/dev-token`)
  const body = await r.json() as { token?: string }
  return body.token ?? ''
}

export async function getToken2(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${GATEWAY}/api/auth/dev-token2`)
  const body = await r.json() as { token?: string }
  return body.token ?? ''
}

export async function authHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await getToken(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function authHeaders2(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await getToken2(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function getToken3(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${GATEWAY}/api/auth/dev-token3`)
  const body = await r.json() as { token?: string }
  return body.token ?? ''
}

export async function authHeaders3(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await getToken3(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Set auth cookie on browser context — bypasses login redirect for UI tests. */
export async function setAuthCookie(context: BrowserContext): Promise<void> {
  const token = await getToken(context.request)
  if (token) {
    await context.addCookies([{
      name: 'anvay_token',
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
