import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://127.0.0.1:8510'

export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await resolveAuthHeader(request)
  if (!auth) return new Response(null, { status: 401 })
  try {
    const { sessionId } = await params
    const resp = await fetch(`${GATEWAY_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    })
    return new Response(null, { status: resp.status })
  } catch {
    return new Response(null, { status: 500 })
  }
}
