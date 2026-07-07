import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

// Real docker build (+ push) — SSE streamed, same proxy shape as analyze/run-tests.
export async function POST(request: Request) {
  const auth = await resolveAuthHeader(request)
  const body = await request.json()
  const upstream = await fetch(`${GATEWAY_URL}/api/editor/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}
