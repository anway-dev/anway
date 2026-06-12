// Server-side auth resolution for /api proxy routes.
// Order: explicit Authorization header (programmatic callers) → anvay_token
// cookie (browser session set at login). No dev-token minting here — the
// login flow is the only way a browser session gets a token.
import { cookies } from 'next/headers'

export async function resolveAuthHeader(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization')
  if (header) return header
  try {
    const token = (await cookies()).get('anvay_token')?.value
    return token ? `Bearer ${token}` : null
  } catch {
    return null
  }
}
