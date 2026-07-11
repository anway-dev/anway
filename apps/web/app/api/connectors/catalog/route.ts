import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/connectors/catalog`, {
      headers: { ...(auth ? { Authorization: auth } : {}), ...envFwd(request) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json([], { status: 200 })
  }
}
