import { getDemoToken, GATEWAY_URL } from '@/lib/gateway-client'

export async function POST(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params
    const auth = (await _req.headers.get('authorization')) || await getDemoToken().then(t => t ? `Bearer ${t}` : '')
    const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/bootstrap`, {
      method: 'POST',
      headers: auth ? { Authorization: auth } : {},
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
