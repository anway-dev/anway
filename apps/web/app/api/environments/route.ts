import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:6900"

export async function GET(request: Request) {
  const auth = await resolveAuthHeader(request)
  const env = request.headers.get('x-anvay-env') ?? 'prod'
  const resp = await fetch(`${GATEWAY_URL}/api/environments`, {
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      'x-anvay-env': env,
    },
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
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
