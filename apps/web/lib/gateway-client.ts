export const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'
const DEMO_EMAIL = process.env['DEMO_EMAIL'] ?? 'admin@demo.anvay.dev'
const DEMO_TENANT_ID = process.env['DEMO_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001'

let _cachedToken: string | null = null
let _tokenExpiry = 0

export async function getDemoToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  try {
    const r = await fetch(`${GATEWAY_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, tenantId: DEMO_TENANT_ID }),
    })
    if (!r.ok) return null
    const body = await r.json() as { token?: string }
    if (!body.token) return null
    try {
      const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64').toString()) as { exp?: number }
      _tokenExpiry = payload.exp ? (payload.exp - 60) * 1000 : Date.now() + 3_600_000
    } catch {
      _tokenExpiry = Date.now() + 3_600_000
    }
    _cachedToken = body.token
    return _cachedToken
  } catch {
    return null
  }
}
