import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:4000"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> }
) {
  const { id, stageId } = await params
  const auth = await resolveAuthHeader(request)
  const body = await request.text()
  const resp = await fetch(`${GATEWAY_URL}/api/pipelines/${id}/stages/${stageId}/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: body || '{}',
  })
  return new Response(resp.body, {
    status: resp.status,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}
