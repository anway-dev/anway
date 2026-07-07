import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

// Real ECS deploy — the connector was entirely read-only before this
// change; no /api/ecs proxy existed at all.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ cluster: string; service: string }> },
) {
  const { cluster, service } = await params
  try {
    const auth = await resolveAuthHeader(request)
    const body = await request.json()
    const resp = await fetch(`${GATEWAY_URL}/api/ecs/services/${cluster}/${service}/deploy`, {
      method: 'POST',
      headers: { ...(auth ? { Authorization: auth } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'gateway unreachable' }, { status: 502 })
  }
}
