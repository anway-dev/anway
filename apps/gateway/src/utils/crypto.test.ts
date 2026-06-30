import { describe, it, expect, beforeEach } from 'vitest'
import { encryptJson, decryptJson, isEncrypted, assertEncryptionKey } from './crypto.js'

describe('crypto', () => {
  beforeEach(() => {
    process.env['ANWAY_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64')
  })

  it('roundtrips an object', () => {
    const orig = { key: 'test-value', nested: { a: 1 } }
    const enc = encryptJson(orig)
    expect(isEncrypted(enc)).toBe(true)
    expect(enc.startsWith('v1:')).toBe(true)
    const dec = decryptJson<typeof orig>(enc)
    expect(dec).toEqual(orig)
  })

  it('roundtrips a simple string value', () => {
    const orig = 'secret-token-123'
    const enc = encryptJson(orig)
    const dec = decryptJson<string>(enc)
    expect(dec).toBe(orig)
  })

  it('produces unique ciphertext per call (different IV)', () => {
    const val = { x: 1 }
    expect(encryptJson(val)).not.toBe(encryptJson(val))
  })

  it('throws on tampered ciphertext', () => {
    const enc = encryptJson('secret')
    // Flip one character in the ciphertext portion
    const parts = enc.slice(3).split(':')
    const ctB64 = parts[2]!
    const flipped = ctB64.slice(0, -1) + (ctB64.slice(-1) === 'A' ? 'B' : 'A')
    const tampered = `v1:${parts[0]}:${parts[1]}:${flipped}`
    expect(() => decryptJson(tampered)).toThrow()
  })

  it('throws on wrong format', () => {
    expect(() => decryptJson('not-encrypted')).toThrow('not an encrypted value')
    expect(() => decryptJson('v1:only-one-part')).toThrow('invalid encrypted format')
  })

  it('isEncrypted returns false for plaintext', () => {
    expect(isEncrypted('hello')).toBe(false)
    expect(isEncrypted('')).toBe(false)
    expect(isEncrypted('v1')).toBe(false) // needs full prefix v1:
  })

  it('assertEncryptionKey throws in production without key', () => {
    const prev = process.env['NODE_ENV']
    const prevKey = process.env['ANWAY_ENCRYPTION_KEY']
    try {
      process.env['NODE_ENV'] = 'production'
      delete process.env['ANWAY_ENCRYPTION_KEY']
      expect(() => assertEncryptionKey()).toThrow()
    } finally {
      process.env['NODE_ENV'] = prev
      process.env['ANWAY_ENCRYPTION_KEY'] = prevKey
    }
  })
})
