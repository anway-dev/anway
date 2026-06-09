const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const qs = searchParams.toString()
  const resp = await fetch(`${GATEWAY_URL}/api/settings/models${qs ? `?${qs}` : ''}`)
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
