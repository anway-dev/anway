import { decryptJson } from './crypto.js'

/**
 * Single source of truth for reading a connector's credentials.
 * Encrypted column wins; falls back to the (legacy) plaintext column only
 * while it still exists. After migration S1.4 drops plaintext, the fallback
 * is simply never hit.
 */
export function effectiveCredentials(
  row: { credentials_enc?: string | null; credentials?: unknown } | undefined,
): Record<string, unknown> {
  if (!row) return {}
  if (row.credentials_enc) {
    try {
      return decryptJson<Record<string, unknown>>(row.credentials_enc)
    } catch {
      return {}
    }
  }
  if (row.credentials && typeof row.credentials === 'object') {
    return row.credentials as Record<string, unknown>
  }
  return {}
}

/** Effective provider api key — encrypted column wins, plaintext is legacy fallback. */
export function effectiveApiKey(
  row: { api_key_enc?: string | null; api_key?: string | null } | undefined,
): string | undefined {
  if (!row) return undefined
  if (row.api_key_enc) {
    try {
      return decryptJson<string>(row.api_key_enc)
    } catch {
      return undefined
    }
  }
  return row.api_key || undefined
}
