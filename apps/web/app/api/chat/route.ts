import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const auth = await resolveAuthHeader(request)
    const response = await fetch(`${GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    })

    if (!response.ok) {
      const text = await response.text()
      return new Response(text, { status: response.status, statusText: response.statusText })
    }

    const stream = response.body
    if (!stream) {
      return new Response('No response body from gateway', { status: 502 })
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'proxy error'
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
