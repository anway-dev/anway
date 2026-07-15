import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

// Proxies the gateway's live incident SSE stream to the browser. The browser
// opens an EventSource here (same-origin, cookie auth); we resolve the auth
// header server-side and forward to the gateway, streaming the events back.
export async function GET(request: Request) {
  const headers: Record<string, string> = { accept: 'text/event-stream' }
  const auth = await resolveAuthHeader(request)
  if (auth) headers['authorization'] = auth

  const resp = await fetch(`${GATEWAY_URL}/api/events/stream`, {
    headers,
    signal: request.signal,
  }).catch(() => null)

  if (!resp || !resp.ok || !resp.body) {
    return new Response('data: {"type":"error"}\n\n', {
      status: resp?.status ?? 502,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  return new Response(resp.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
