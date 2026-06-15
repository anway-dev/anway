const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://127.0.0.1:4000'

export async function POST() {
  const resp = await fetch(`${GATEWAY_URL}/api/auth/demo`, { method: 'POST' })
  const body = await resp.text()
  return new Response(body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
