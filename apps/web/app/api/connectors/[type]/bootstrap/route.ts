
const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:4000"


async function getToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers")
    return (await cookies()).get("anvay_token")?.value ?? null
  } catch {
    return null
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params
    const auth = _req.headers.get('authorization') || await getToken().then(t => t ? `Bearer ${t}` : '')
    const resp = await fetch(`${GATEWAY_URL}/api/connectors/${type}/bootstrap`, {
      method: 'POST',
      headers: auth ? { Authorization: auth } : {},
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
