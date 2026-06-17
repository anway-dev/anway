import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Paths that don't require authentication
const PUBLIC_PATHS = ['/login', '/setup', '/api/auth', '/api/setup', '/_next', '/favicon.ico']

// Dev mode: bypass auth for localhost when SKIP_AUTH=true (E2E tests)
const SKIP_AUTH = process.env['SKIP_AUTH'] === 'true'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths without auth
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Dev mode bypass for E2E tests
  if (SKIP_AUTH) {
    return NextResponse.next()
  }

  // Check for auth token cookie
  const token = request.cookies.get('anvay_token')?.value

  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
}
