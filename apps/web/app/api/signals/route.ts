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

  const url = new URL(request.url)
  const qs = url.search
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/signals${qs}`, {
      headers: { Authorization: `Bearer ${token}`, ...envFwd(request) },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
