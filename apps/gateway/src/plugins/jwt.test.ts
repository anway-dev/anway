import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import jwtPlugin from './jwt.js'

// Production boot hardening: a weak or repo-default JWT_SECRET must refuse
// to boot in NODE_ENV=production (forgeable session tokens otherwise), and
// must keep working untouched in development.

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  delete process.env['JWT_PRIVATE_KEY']
  delete process.env['JWT_PUBLIC_KEY']
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

async function boot(): Promise<void> {
  const app = Fastify({ logger: false })
  try {
    await app.register(jwtPlugin)
  } finally {
    await app.close()
  }
}

describe('jwt plugin production secret hardening', () => {
  it('refuses a known repo-default secret in production', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['JWT_SECRET'] = 'dev-secret-change-in-production'
    await expect(boot()).rejects.toThrow(/known default/)
  })

  it('refuses a short secret in production', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['JWT_SECRET'] = 'short-but-not-default'
    await expect(boot()).rejects.toThrow(/at least 32 characters/)
  })

  it('accepts a strong secret in production', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['JWT_SECRET'] = 'a'.repeat(24) + 'unique-suffix-xyz'
    await expect(boot()).resolves.toBeUndefined()
  })

  it('allows the dev default outside production', async () => {
    process.env['NODE_ENV'] = 'development'
    process.env['JWT_SECRET'] = 'dev-secret-change-in-production'
    await expect(boot()).resolves.toBeUndefined()
  })

  it('still requires some secret to be set at all', async () => {
    process.env['NODE_ENV'] = 'development'
    delete process.env['JWT_SECRET']
    await expect(boot()).rejects.toThrow(/JWT_SECRET or JWT_PRIVATE_KEY/)
  })
})
