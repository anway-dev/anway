import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:6900"

export async function GET(request: Request) {
  const auth = await resolveAuthHeader(request)
  const resp = await fetch(`${GATEWAY_URL}/api/pipelines`, {
    headers: { ...(auth ? { Authorization: auth } : {}) },
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}

export async function POST(request: Request) {
  const auth = await resolveAuthHeader(request)
  const body = await request.text()
  const resp = await fetch(`${GATEWAY_URL}/api/pipelines`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body,
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
