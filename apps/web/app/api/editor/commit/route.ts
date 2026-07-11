import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

// Real git commit+push — previously had no proxy at all (the gateway route
// itself didn't exist before this same change either).
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const body = await request.json()
    const resp = await fetch(`${GATEWAY_URL}/api/editor/commit`, {
      method: 'POST',
      headers: { ...(auth ? { Authorization: auth } : {}), 'content-type': 'application/json', ...envFwd(request) },
      body: JSON.stringify(body),
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'proxy error' }, { status: 502 })
  }
}
