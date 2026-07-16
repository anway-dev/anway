import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/connectors/catalog`, {
      headers: { ...(auth ? { Authorization: auth } : {}), ...envFwd(request) },
    })
    // Contract: this endpoint ALWAYS returns a JSON array. A slow/erroring
    // gateway (e.g. 401/500 with an {error} body, or a timeout) must not leak
    // a non-array to the client — consumers call catalog.filter/.map on render,
    // so a non-array throws an uncaught TypeError that breaks the whole shell.
    const data = await resp.json().catch(() => null)
    return Response.json(Array.isArray(data) ? data : [], { status: 200 })
  } catch {
    return Response.json([], { status: 200 })
  }
}
