
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
    const entResp = await fetch(`${GATEWAY_URL}/api/graph/entities?limit=500&exclude_types=Incident,Commit,Deploy`, { headers: { Authorization: `Bearer ${token}` } })
    const entJson = await entResp.json().catch(() => ({}))
    // Gateway returns { data: [...], relationships: [...], nextCursor }
    const entities = entJson.entities ?? entJson.data ?? []
    const relationships = entJson.relationships ?? []
    return Response.json({ entities, relationships }, { status: 200 })
  } catch {
    return new Response(EMPTY, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
