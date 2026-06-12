
const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:4000"


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
    const resp = await fetch(`${GATEWAY_URL}/api/graph/entities`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(EMPTY, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
