import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const url = new URL(request.url)
    const path = url.searchParams.get('path') ?? ''
    const resp = await fetch(`${GATEWAY_URL}/api/editor/files?path=${encodeURIComponent(path)}`, {
      headers: { ...(auth ? { Authorization: auth } : {}) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json([], { status: 200 })
  }
}
