import { NextResponse } from 'next/server'

const GATEWAY = process.env['GATEWAY_URL'] ?? 'http://127.0.0.1:4000'

export async function POST(request: Request) {
  const cookie = request.headers.get('cookie') ?? ''
  // Notify gateway (best-effort — JWT is stateless, gateway just returns ok)
  await fetch(`${GATEWAY}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie },
  }).catch(() => {})

  const response = NextResponse.json({ ok: true })
  response.cookies.set('anvay_token', '', {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return response
}
