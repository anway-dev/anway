const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params
  const auth = request.headers.get('authorization') || ''
  const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/bootstrap-status`, {
    headers: auth ? { Authorization: auth } : {},
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
