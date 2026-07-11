import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET(request: Request) {
  const auth = await resolveAuthHeader(request)
  if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/settings/token-limits`, {
      headers: { Authorization: auth, ...envFwd(request) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'gateway unreachable' }, { status: 502 })
  }
}

export async function PUT(request: Request) {
  const auth = await resolveAuthHeader(request)
  if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.text()
    const resp = await fetch(`${GATEWAY_URL}/api/settings/token-limits`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body,
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'gateway unreachable' }, { status: 502 })
  }
}
