import { getDemoToken, GATEWAY_URL } from '@/lib/gateway-client'

export async function GET() {
  const token = await getDemoToken()
  if (!token) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })

  try {
    const resp = await fetch(`${GATEWAY_URL}/api/automations/monitors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
