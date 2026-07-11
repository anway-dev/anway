// Server-side auth resolution for /api proxy routes.
// Order: explicit Authorization header (programmatic callers) → anway_token
// cookie (browser session set at login). No dev-token minting here — the
// login flow is the only way a browser session gets a token.
import { cookies } from 'next/headers'

export async function resolveAuthHeader(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization')
  if (header) return header
  try {
    const token = (await cookies()).get('anway_token')?.value
    return token ? `Bearer ${token}` : null
  } catch {
    return null
  }
}

// Forward the active-environment header to the gateway. The env selector
// (lib/env-context.tsx) attaches X-Anway-Env on every browser /api call;
// proxy routes must pass it through or the gateway can never scope by env
// (found in manual testing: the header died at the Next proxy layer).
export function envFwd(request: Request): Record<string, string> {
  const env = request.headers.get('x-anway-env')
  return env ? { 'x-anway-env': env } : {}
}
