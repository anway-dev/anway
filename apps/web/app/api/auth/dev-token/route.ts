const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/auth/dev-token`)
    const json = await res.json()
    return Response.json(json, { status: res.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'proxy error'
    return Response.json({ error: msg }, { status: 502 })
  }
}
