import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://127.0.0.1:8510'

export async function DELETE(request: Request) {
  const auth = await resolveAuthHeader(request)
  if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/admin/token-usage/reset`, {
      method: 'DELETE',
      headers: { Authorization: auth, ...envFwd(request) },
    })
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: 'gateway error' }))
      return Response.json(body, { status: resp.status })
    }
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'gateway unreachable' }, { status: 502 })
  }
}
