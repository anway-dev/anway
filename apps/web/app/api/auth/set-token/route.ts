import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { token } = await request.json() as { token?: string }
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('anway_token', token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24, // 24h
  })

  return response
}
