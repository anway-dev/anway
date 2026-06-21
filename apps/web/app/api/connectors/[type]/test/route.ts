import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function POST(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params
    const auth = await resolveAuthHeader(request)
    const body = await request.text()
    const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body,
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ ok: false, error: 'gateway unreachable' }, { status: 200 })
  }
}
