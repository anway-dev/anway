import { describe, it, expect, afterEach } from 'vitest'
import { assertSecureJwtSecret } from './env.js'

describe('assertSecureJwtSecret', () => {
  const prevNode = process.env['NODE_ENV']
  const prevSecret = process.env['JWT_SECRET']

  afterEach(() => {
    process.env['NODE_ENV'] = prevNode
    process.env['JWT_SECRET'] = prevSecret
  })

  it('does not throw in development with weak secret', () => {
    process.env['NODE_ENV'] = 'development'
    process.env['JWT_SECRET'] = 'weak'
    expect(() => assertSecureJwtSecret()).not.toThrow()
  })

  it('throws in production with short secret', () => {
    process.env['NODE_ENV'] = 'production'
    process.env['JWT_SECRET'] = 'short'
    expect(() => assertSecureJwtSecret()).toThrow()
  })

  it('throws in production with dev default', () => {
    process.env['NODE_ENV'] = 'production'
    process.env['JWT_SECRET'] = 'dev-secret-change-in-production'
    expect(() => assertSecureJwtSecret()).toThrow()
  })

  it('passes in production with strong secret', () => {
    process.env['NODE_ENV'] = 'production'
    process.env['JWT_SECRET'] = 'a-strong-secret-with-at-least-32-chars-abcdefgh'
    expect(() => assertSecureJwtSecret()).not.toThrow()
  })
})
