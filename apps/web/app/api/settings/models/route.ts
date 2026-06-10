const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:4000'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Extract apiKey from query, move to header to prevent SSRF via URL leak
  const apiKey = searchParams.get('apiKey')
  searchParams.delete('apiKey')
  const qs = searchParams.toString()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const auth = request.headers.get('authorization')
  if (auth) headers['authorization'] = auth
  if (apiKey) headers['x-api-key'] = apiKey
  const resp = await fetch(`${GATEWAY_URL}/api/settings/models${qs ? `?${qs}` : ''}`, { headers })
  return new Response(resp.body, { status: resp.status, headers: { 'content-type': 'application/json' } })
}
