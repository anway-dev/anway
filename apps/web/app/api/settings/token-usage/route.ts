import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/settings/token-usage`, {
      headers: { ...(auth ? { Authorization: auth } : {}) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ used: 0, budget: 1_000_000, month: new Date().toISOString().slice(0, 7) }, { status: 200 })
  }
}
