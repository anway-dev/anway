import type { Page, APIRequestContext } from '@playwright/test'

export const GATEWAY = 'http://127.0.0.1:4000'
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
