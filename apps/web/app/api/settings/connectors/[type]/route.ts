const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function PUT(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params
    const body = await request.json()
    const authHeader = request.headers.get('Authorization')
    const resp = await fetch(`${GATEWAY_URL}/api/settings/connectors/${type}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
