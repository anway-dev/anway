import { decryptJson } from './crypto.js'

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

/** Returns decrypted API key from encrypted column. `api_key` plaintext was dropped in S1.4. */
export function effectiveApiKey(
  row: { api_key_enc?: string | null } | undefined,
): string | undefined {
  if (!row?.api_key_enc) return undefined
  try {
    return decryptJson<string>(row.api_key_enc)
  } catch {
    return undefined
  }
}
