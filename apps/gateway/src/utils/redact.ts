const SECRET_KEYS = /key|token|secret|password|credential|authorization|api[_-]?key/i
const REDACTED = '[REDACTED]'

export function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(redactSecrets)
  if (typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SECRET_KEYS.test(key)) {
      result[key] = REDACTED
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
      result[key] = redactSecrets(value)
    } else {
      result[key] = value
    }
  }
  return result
}
