import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

export async function GET(request: Request) {
  const auth = await resolveAuthHeader(request)
  if (!auth) return Response.json([], { status: 200 })
  const env = request.headers.get('x-anvay-env') ?? 'prod'
  try {
    const resp = await fetch(`${GATEWAY_URL}/api/environments`, {
      headers: { Authorization: auth, 'x-anvay-env': env },
    })
    if (!resp.ok) return Response.json([], { status: 200 })
    return new Response(resp.body, { status: 200, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json([], { status: 200 })
  }
}

export async function POST(request: Request) {
  const auth = await resolveAuthHeader(request)
  const env = request.headers.get('x-anvay-env') ?? 'prod'
  const body = await request.text()
  const resp = await fetch(`${GATEWAY_URL}/api/environments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
      'x-anvay-env': env,
    },
    body,
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
