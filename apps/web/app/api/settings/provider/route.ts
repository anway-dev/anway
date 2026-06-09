const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const resp = await fetch(`${GATEWAY_URL}/api/settings/provider`, {
    headers: { ...(authHeader ? { Authorization: authHeader } : {}) },
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}

export async function POST(request: Request) {
  const body = await request.json()
  const authHeader = request.headers.get('Authorization')
  const resp = await fetch(`${GATEWAY_URL}/api/settings/provider`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
