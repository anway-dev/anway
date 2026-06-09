const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params
  const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/bootstrap-status`)
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
