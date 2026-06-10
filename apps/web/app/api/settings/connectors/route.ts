const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization')
    const resp = await fetch(`${GATEWAY_URL}/api/settings/connectors`, {
      headers: { ...(authHeader ? { Authorization: authHeader } : {}) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
