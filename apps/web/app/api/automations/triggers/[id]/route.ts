const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'
const DEMO_EMAIL = process.env['DEMO_EMAIL'] ?? 'demo@anvay.dev'
const DEMO_TENANT_ID = process.env['DEMO_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001'

async function getDemoToken(): Promise<string | null> {
  try {
    const r = await fetch(`${GATEWAY_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, tenantId: DEMO_TENANT_ID }),
    })
    if (!r.ok) return null
    const body = await r.json() as { token?: string }
    return body.token ?? null
  } catch {
    return null
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = await getDemoToken()
  if (!token) return new Response(JSON.stringify({ error: 'auth failed' }), { status: 503, headers: { 'Content-Type': 'application/json' } })

  try {
    const body = await request.text()
    const resp = await fetch(`${GATEWAY_URL}/api/automations/triggers/${id}`, {
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = await getDemoToken()
  if (!token) return new Response(JSON.stringify({ error: 'auth failed' }), { status: 503, headers: { 'Content-Type': 'application/json' } })

  try {
    const resp = await fetch(`${GATEWAY_URL}/api/automations/triggers/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'gateway unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}
