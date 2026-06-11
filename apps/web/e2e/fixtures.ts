import type { APIRequestContext } from '@playwright/test'

export const GATEWAY = 'http://127.0.0.1:4000'
export const WEB = 'http://localhost:3000'
export const DEMO_TENANT = '00000000-0000-0000-0000-000000000001'
export const DEMO_EMAIL = 'dev@anvay.local'

export async function getToken(request: APIRequestContext): Promise<string> {
  const r = await request.get(`${GATEWAY}/api/auth/dev-token`)
  const body = await r.json() as { token?: string }
  return body.token ?? ''
}

export async function authHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await getToken(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
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
