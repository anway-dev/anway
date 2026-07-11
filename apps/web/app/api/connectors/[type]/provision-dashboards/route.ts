import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function POST(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/provision-dashboards`, {
      method: 'POST',
      headers: { ...(auth ? { Authorization: auth } : {}), ...envFwd(request) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ ok: false, error: 'gateway unreachable' }, { status: 200 })
  }
}
