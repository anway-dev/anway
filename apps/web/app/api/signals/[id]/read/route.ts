const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

async function getToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers")
    return (await cookies()).get("anway_token")?.value ?? null
  } catch {
    return null
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken()
  if (!token) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

  const { id } = await params
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/signals/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ error: 'gateway unreachable' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
  }
}
