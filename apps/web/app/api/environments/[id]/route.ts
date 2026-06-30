import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await resolveAuthHeader(request)
  const env = request.headers.get('x-anway-env') ?? 'prod'
  const body = await request.text()
  const resp = await fetch(`${GATEWAY_URL}/api/environments/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
      'x-anway-env': env,
    },
    body,
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await resolveAuthHeader(request)
  const env = request.headers.get('x-anway-env') ?? 'prod'
  const resp = await fetch(`${GATEWAY_URL}/api/environments/${id}`, {
    method: 'DELETE',
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      'x-anway-env': env,
    },
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
