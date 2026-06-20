const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function GET() {
  return Response.redirect(`${GATEWAY_URL}/auth/oidc/login`)
}
