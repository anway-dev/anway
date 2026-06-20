import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Auth is handled client-side in app/page.tsx via /api/auth/me check.
// This proxy only exists to allow SKIP_AUTH bypass for E2E tests.
const SKIP_AUTH = process.env['SKIP_AUTH'] === 'true'

export function proxy(request: NextRequest) {
  if (SKIP_AUTH) {
    return NextResponse.next()
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/auth).*)',
  ],
}
