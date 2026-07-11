import { resolveAuthHeader, envFwd } from '@/lib/server-auth'

const GATEWAY_URL = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:8510"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthHeader(request)
    const resp = await fetch(`${GATEWAY_URL}/api/terraform/detect`, {
      headers: { ...(auth ? { Authorization: auth } : {}), ...envFwd(request) },
    })
    return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
  } catch {
    // Fallback: demo only
    return Response.json([{ id: 'demo', label: 'Local (Docker)', platform: 'docker', tfEnv: 'demo', connectorType: 'local', meta: {} }])
  }
}
