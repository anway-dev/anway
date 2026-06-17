import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:6900"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path') ?? ''
    const resp = await fetch(`${GATEWAY_URL}/api/editor/file?path=${encodeURIComponent(filePath)}`, {
      headers: { ...(auth ? { Authorization: auth } : {}) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'proxy error' }, { status: 502 })
  }
}
