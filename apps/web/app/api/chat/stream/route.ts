const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const authHeader = request.headers.get('Authorization')
    const response = await fetch(`${GATEWAY_URL}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    })

    if (!response.ok) {
      const text = await response.text()
      return new Response(text, { status: response.status })
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'proxy error'
    return new Response(`data: ${JSON.stringify({ type: 'error', code: 'PROXY_ERROR', message: msg })}\n\ndata: {"type":"done"}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }
}
