import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

// POST — API key sent in JSON body, never in querystring (prevents browser history + request log exposure)
export async function POST(request: Request) {
  try {
    const body = await request.json() as { provider?: string; baseUrl?: string; apiKey?: string }
    const { apiKey, provider, baseUrl } = body

    const params = new URLSearchParams()
    if (provider) params.set('provider', provider)
    if (baseUrl) params.set('baseUrl', baseUrl)
    const qs = params.toString()

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const auth = await resolveAuthHeader(request)
    if (auth) headers['authorization'] = auth
    if (apiKey) headers['x-api-key'] = apiKey

    const resp = await fetch(`${GATEWAY_URL}/api/settings/models${qs ? `?${qs}` : ''}`, { headers })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
