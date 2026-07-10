import { describe, it, expect } from 'vitest'
import { validateJwtSecretConfig } from './jwt.js'

// Production boot hardening: a weak or repo-default JWT_SECRET must refuse
// to boot in NODE_ENV=production (forgeable session tokens otherwise), and
// must keep working untouched in development.
//
// Tests call the pure validator with injected values — the first version
// mutated process.env, which races with other test FILES sharing the vitest
// worker (real Actions run 29095118343: oidc.test.ts's buildApp saw
// JWT_SECRET deleted mid-flight).

describe('jwt production secret hardening', () => {
  it('refuses a known repo-default secret in production', () => {
    expect(() => validateJwtSecretConfig({
      secret: 'dev-secret-change-in-production', nodeEnv: 'production',
    })).toThrow(/known default/)
  })

  it('refuses a short secret in production', () => {
    expect(() => validateJwtSecretConfig({
      secret: 'short-but-not-default', nodeEnv: 'production',
    })).toThrow(/at least 32 characters/)
  })

  it('accepts a strong secret in production', () => {
    expect(() => validateJwtSecretConfig({
      secret: 'a'.repeat(24) + 'unique-suffix-xyz', nodeEnv: 'production',
    })).not.toThrow()
  })

  it('allows the dev default outside production', () => {
    expect(() => validateJwtSecretConfig({
      secret: 'dev-secret-change-in-production', nodeEnv: 'development',
    })).not.toThrow()
  })

  it('still requires some secret to be set at all', () => {
    expect(() => validateJwtSecretConfig({ nodeEnv: 'development' }))
      .toThrow(/JWT_SECRET or JWT_PRIVATE_KEY/)
  })

  it('an RS256 private key bypasses the HS256 secret checks', () => {
    expect(() => validateJwtSecretConfig({
      privateKey: '-----BEGIN PRIVATE KEY-----', nodeEnv: 'production',
    })).not.toThrow()
  })
})
