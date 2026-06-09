const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET() {
  const resp = await fetch(`${GATEWAY_URL}/api/settings/provider-manifests`)
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
