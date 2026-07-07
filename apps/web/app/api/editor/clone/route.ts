import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const body = await request.json()
    const resp = await fetch(`${GATEWAY_URL}/api/editor/clone`, {
      method: 'POST',
      headers: { ...(auth ? { Authorization: auth } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'proxy error' }, { status: 502 })
  }
}
