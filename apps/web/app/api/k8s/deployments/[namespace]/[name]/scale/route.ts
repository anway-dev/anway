import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ namespace: string; name: string }> },
) {
  const { namespace, name } = await params
  try {
    const auth = await resolveAuthHeader(request)
    const body = await request.json()
    const resp = await fetch(`${GATEWAY_URL}/api/k8s/deployments/${namespace}/${name}/scale`, {
      method: 'POST',
      headers: { ...(auth ? { Authorization: auth } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'gateway unreachable' }, { status: 502 })
  }
}
