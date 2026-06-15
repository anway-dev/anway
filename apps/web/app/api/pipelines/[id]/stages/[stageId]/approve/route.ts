import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:4000"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> }
) {
  const { id, stageId } = await params
  const auth = await resolveAuthHeader(request)
  const resp = await fetch(`${GATEWAY_URL}/api/pipelines/${id}/stages/${stageId}/approve`, {
    method: 'POST',
    headers: { ...(auth ? { Authorization: auth } : {}) },
  })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
