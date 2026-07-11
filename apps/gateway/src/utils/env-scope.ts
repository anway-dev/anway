import type { PrismaClient } from '@prisma/client'

/**
 * Environment scoping — resolves the request's active environment NAME
 * (jwt.ts parses X-Anway-Env into request.user.env) to the tenant's
 * environments row id.
 *
 * Scoping convention across the env_id columns: `env_id IS NULL` means the
 * row is global (visible in every environment); a non-null env_id pins the
 * row to that environment only. An unknown env name resolves to null, which
 * callers treat as "global rows only" — fail-closed rather than leaking
 * another environment's rows.
 *
 * Found in manual testing: the header/claim plumbing existed end to end but
 * NOTHING consumed it — 12 tables carried env_id columns no query filtered
 * on, so switching environments changed nothing anywhere.
 */

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { id: string | null; at: number }>()

export async function resolveEnvId(
  prisma: PrismaClient,
  tenantId: string,
  envName: string | undefined,
): Promise<string | null> {
  const name = (envName ?? '').trim()
  if (!name) return null
  const key = `${tenantId}:${name}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.id

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM environments WHERE tenant_id = ${tenantId}::uuid AND name = ${name} LIMIT 1
  `.catch(() => [] as Array<{ id: string }>)
  const id = rows[0]?.id ?? null
  cache.set(key, { id, at: Date.now() })
  return id
}
