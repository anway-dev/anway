
const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"


async function getToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers")
    return (await cookies()).get("anvay_token")?.value ?? null
  } catch {
    return null
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = await getToken()
  if (!token) return new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  try {
    const resp = await fetch(`${GATEWAY_URL}/api/cron/${id}/runs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await resp.text()
    return new Response(data, { status: resp.status, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
