import { NextResponse } from 'next/server'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:8510'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string }
    const resp = await fetch(`${GATEWAY_URL}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json() as { token?: string; error?: string }
    if (!resp.ok || !data.token) {
      return NextResponse.json({ error: data.error ?? 'setup failed' }, { status: resp.status })
    }
    const response = NextResponse.json({ ok: true })
    response.cookies.set('anway_token', data.token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24,
    })
    return response
  } catch {
    return NextResponse.json({ error: 'gateway unreachable' }, { status: 503 })
  }
}
