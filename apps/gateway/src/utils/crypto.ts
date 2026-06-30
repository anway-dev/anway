import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const KEY_LEN = 32
const PREFIX = 'v1:'

function getKey(): Buffer {
  const raw = process.env['ANWAY_ENCRYPTION_KEY']
  if (!raw) throw new Error('ANWAY_ENCRYPTION_KEY not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LEN) throw new Error(`ANWAY_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes, got ${key.length}`)
  return key
}

export function encryptJson(obj: unknown): string {
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const plaintext = JSON.stringify(obj)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptJson<T = Record<string, unknown>>(blob: string): T {
  if (!blob.startsWith(PREFIX)) throw new Error('not an encrypted value')
  const parts = blob.slice(PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error('invalid encrypted format')
  const [ivB64, tagB64, ctB64] = parts as [string, string, string]
  const key = getKey()
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
  return JSON.parse(decrypted.toString('utf-8')) as T
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function assertEncryptionKey(): void {
  if (process.env['NODE_ENV'] !== 'production') return
  try {
    getKey()
  } catch (err) {
    throw new Error(`ANWAY_ENCRYPTION_KEY required in production: ${err instanceof Error ? err.message : ''}`)
  }
}
