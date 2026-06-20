const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET() {
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/auth/methods`)
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ local: false, demo: false, oidc: false, google: false, github: false }, { status: 200 })
  }
}
