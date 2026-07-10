import { describe, it, expect } from 'vitest'
import { assertSecureJwtSecret } from './env.js'

// Tests inject values — the env-mutating version raced other test files in
// the same vitest worker (see assertSecureJwtSecret's comment in env.ts).
describe('assertSecureJwtSecret', () => {
  it('does not throw in development with weak secret', () => {
    expect(() => assertSecureJwtSecret({ NODE_ENV: 'development', JWT_SECRET: 'weak' })).not.toThrow()
  })

  it('throws in production with short secret', () => {
    expect(() => assertSecureJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow()
  })

  it('throws in production with a known repo default', () => {
    expect(() => assertSecureJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'dev-secret-change-in-production' })).toThrow()
    expect(() => assertSecureJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'ci-test-secret-not-for-real-use-32chars' })).toThrow()
  })

  it('passes in production with strong secret', () => {
    expect(() => assertSecureJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'a-strong-secret-with-at-least-32-chars-abcdefgh' })).not.toThrow()
  })

  it('an RS256 keypair bypasses the HS256 secret checks', () => {
    expect(() => assertSecureJwtSecret({ NODE_ENV: 'production', JWT_PRIVATE_KEY: 'k', JWT_PUBLIC_KEY: 'k' })).not.toThrow()
  })

  it('throws in production with no secret at all', () => {
    expect(() => assertSecureJwtSecret({ NODE_ENV: 'production' })).toThrow()
  })
})
