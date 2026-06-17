
const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"


async function getToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers")
    return (await cookies()).get("anvay_token")?.value ?? null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.toString()

  const token = await getToken()
  if (!token) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const url = `${GATEWAY_URL}/api/incidents${query ? `?${query}` : ''}`
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await resp.text()
    return new Response(data, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
