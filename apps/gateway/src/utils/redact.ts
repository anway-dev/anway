// kubeconfig/sa_json (GCP service-account JSON) don't contain any of "key",
// "token", etc. as a substring, so they previously passed through this
// filter untouched — confirmed live via independent review, the same blind
// spot as the connector-credentials GET route (settings.ts), which had its
// own separate redaction list missing these same two field types.
const SECRET_KEYS = /key|token|secret|password|credential|authorization|api[_-]?key|kubeconfig|sa[_-]?json|service[_-]?account/i
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
