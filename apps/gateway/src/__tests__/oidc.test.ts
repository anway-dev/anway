import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Same convention as every sibling suite that calls buildApp: supply the JWT
// secret this file needs instead of relying on ambient env (this was the
// only buildApp suite without it — failed on CI runners where no .env or
// job-level secret reached the vitest fork: runs 29095118343..29100451297).
process.env['JWT_SECRET'] = 'test-secret'

import { buildApp } from '../app.js'

describe('OIDC routes', () => {
  it('GET /auth/oidc/status returns configured:false when no OIDC vars set', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/auth/oidc/status' })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body) as { configured: boolean }
    expect(body.configured).toBe(false)
    await app.close()
  })

  it('GET /auth/oidc/login returns 404 when not configured', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/auth/oidc/login' })
    expect(r.statusCode).toBe(404)
    await app.close()
  })

  it('GET /auth/oidc/callback returns 404 when not configured', async () => {
    const app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/auth/oidc/callback?code=test&state=test' })
    expect([400, 404].includes(r.statusCode)).toBe(true)
    await app.close()
  })
})
