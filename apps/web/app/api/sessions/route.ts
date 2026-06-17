import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://127.0.0.1:8510'

export async function GET(request: Request) {
  const auth = await resolveAuthHeader(request)
  if (!auth) return Response.json([], { status: 200 })
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/sessions`, {
      headers: { Authorization: auth },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return Response.json([], { status: 200 })
  }
}
