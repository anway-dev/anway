import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/gate/policies`, {
      headers: { ...(auth ? { Authorization: auth } : {}), ...envFwd(request) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/gate/policies`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify(body),
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
