import { describe, it, expect } from 'vitest'
import { redactSecrets } from './redact.js'

describe('redactSecrets', () => {
  it('redacts apiKey field', () => {
    expect(redactSecrets({ apiKey: 'sk-ant-secret' })).toEqual({ apiKey: '[REDACTED]' })
  })

  it('redacts token field', () => {
    expect(redactSecrets({ token: 'ghp_abc123' })).toEqual({ token: '[REDACTED]' })
  })

  it('redacts password field', () => {
    expect(redactSecrets({ password: 'admin123' })).toEqual({ password: '[REDACTED]' })
  })

  it('redacts deeply nested secret', () => {
    const obj = { config: { db: { password: 'secret' } } }
    expect(redactSecrets(obj)).toEqual({ config: { db: { password: '[REDACTED]' } } })
  })

  it('leaves non-secret keys untouched', () => {
    expect(redactSecrets({ name: 'test', count: 42 })).toEqual({ name: 'test', count: 42 })
  })

  it('handles arrays by recursing', () => {
    expect(redactSecrets([{ key: 'val' }, { token: 'x' }])).toEqual([{ key: '[REDACTED]' }, { token: '[REDACTED]' }])
  })

  it('handles null/undefined', () => {
    expect(redactSecrets(null)).toBe(null)
    expect(redactSecrets(undefined)).toBe(undefined)
  })

  it('handles Date objects', () => {
    const d = new Date()
    expect(redactSecrets(d)).toBe(d)
  })
})
