import { envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"


async function getToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers")
    return (await cookies()).get("anway_token")?.value ?? null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const token = await getToken()
  if (!token) return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })

  try {
    const resp = await fetch(`${GATEWAY_URL}/api/automations/triggers`, {
      headers: { Authorization: `Bearer ${token}`, ...envFwd(request) },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}

export async function POST(request: Request) {
  const token = await getToken()
  if (!token) return new Response(JSON.stringify({ error: 'auth failed' }), { status: 503, headers: { 'Content-Type': 'application/json' } })

  try {
    const body = await request.text()
    const resp = await fetch(`${GATEWAY_URL}/api/automations/triggers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'gateway unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}
