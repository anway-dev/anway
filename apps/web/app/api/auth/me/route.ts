import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:6900'

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    if (!auth) return Response.json({ error: 'unauthenticated' }, { status: 401 })
    const resp = await fetch(`${GATEWAY_URL}/api/auth/me`, {
      headers: { Authorization: auth },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ email: '—', role: '—' }, { status: 200 })
  }
}
