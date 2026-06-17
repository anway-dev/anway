
const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"


async function getToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers")
    return (await cookies()).get("anvay_token")?.value ?? null
  } catch {
    return null
  }
}

const EMPTY = JSON.stringify({ entities: [], relationships: [] })

export async function GET() {
  const token = await getToken()
  if (!token) return new Response(EMPTY, { status: 200, headers: { 'Content-Type': 'application/json' } })

  try {
    const [entResp, relResp] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/graph/entities`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${GATEWAY_URL}/api/graph/relationships`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
    ])
    const entJson = await entResp.json().catch(() => ({}))
    const relJson = relResp ? await relResp.json().catch(() => ({})) : {}
    // Gateway wraps in { data: [...] } — normalize to { entities, relationships }
    const entities = entJson.entities ?? entJson.data ?? []
    const relationships = relJson.relationships ?? relJson.data ?? []
    return Response.json({ entities, relationships }, { status: 200 })
  } catch {
    return new Response(EMPTY, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
