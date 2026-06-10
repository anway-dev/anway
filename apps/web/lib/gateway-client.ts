export const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

let _cachedToken: string | null = null
let _tokenExpiry = 0
let _fetchPromise: Promise<string | null> | null = null

export async function getDemoToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken
  if (_fetchPromise) return _fetchPromise
  _fetchPromise = (async () => {
    try {
      const r = await fetch(`${GATEWAY_URL}/api/auth/dev-token`)
      if (!r.ok) return null
      const body = await r.json() as { token?: string }
      if (!body.token) return null
      try {
        const payload = JSON.parse(Buffer.from(body.token.split('.')[1]!, 'base64').toString()) as { exp?: number }
        _tokenExpiry = payload.exp ? (payload.exp - 60) * 1000 : Date.now() + 3_600_000
      } catch {
        _tokenExpiry = Date.now() + 3_600_000
      }
      _cachedToken = body.token
      return _cachedToken
    } catch {
      return null
    } finally {
      _fetchPromise = null
    }
  })()
  return _fetchPromise
}
