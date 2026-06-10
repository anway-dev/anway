const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/alerts`, {
      headers: auth ? { Authorization: auth } : {},
    })
    const data = await resp.text()
    return new Response(data, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
