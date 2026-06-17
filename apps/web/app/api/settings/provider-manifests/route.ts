const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET() {
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/settings/provider-manifests`)
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
