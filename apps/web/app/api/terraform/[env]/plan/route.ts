import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:6900"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ env: string }> }
) {
  const { env } = await params
  const auth = await resolveAuthHeader(request)
  const upstream = await fetch(`${GATEWAY_URL}/api/terraform/${env}/plan`, {
    headers: { ...(auth ? { Authorization: auth } : {}) },
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}
