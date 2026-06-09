import { getDemoToken, GATEWAY_URL } from '@/lib/gateway-client'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = await getDemoToken()
  if (!token) return new Response(JSON.stringify({ error: 'auth failed' }), { status: 503, headers: { 'Content-Type': 'application/json' } })

  try {
    const body = await request.text()
    const resp = await fetch(`${GATEWAY_URL}/api/automations/monitors/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'gateway unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}
