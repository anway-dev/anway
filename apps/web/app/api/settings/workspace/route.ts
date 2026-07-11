import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/settings/workspace`, {
      headers: { ...(auth ? { Authorization: auth } : {}), ...envFwd(request) },
    })
    if (!resp.ok) {
      return Response.json({ name: 'Anway' }, { status: 200 })
    }
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ name: 'Anway' }, { status: 200 })
  }
}
