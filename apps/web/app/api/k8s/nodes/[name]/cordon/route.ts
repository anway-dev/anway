import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params
  try {
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/k8s/nodes/${name}/cordon`, {
      method: 'POST',
      headers: { ...(auth ? { Authorization: auth } : {}), 'content-type': 'application/json' },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'gateway unreachable' }, { status: 502 })
  }
}
