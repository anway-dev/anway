import { resolveAuthHeader } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

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

// Real file save (POST) — was entirely missing, this route only ever
// proxied the read (GET). Product verification found this was the reason
// the editor could never actually persist an edit.
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const body = await request.json()
    const resp = await fetch(`${GATEWAY_URL}/api/editor/file`, {
      method: 'POST',
      headers: { ...(auth ? { Authorization: auth } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    return Response.json({ error: 'proxy error' }, { status: 502 })
  }
}
