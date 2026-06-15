import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
