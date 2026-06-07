import { StructuralGraph, createPostgresQueryFn } from '@anvay/agent'
import type { PgPoolLike, IKnowledgeGraph } from '@anvay/agent'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import type { TenantId } from '@anvay/types'

/**
 * Returns a StructuralGraph backed by Prisma (withTenant for RLS GUC).
 * The caller is responsible for providing the correct tenantId.
 *
 * This is the primary path — used in chat.ts route handler and anywhere
 * that operates within a tenant-scoped request.
 */
export function createKnowledgeGraph(tenantId: TenantId): IKnowledgeGraph {
  return new StructuralGraph(
    (sql: string, params?: unknown[]) =>
      withTenant(prisma, tenantId, (tx) =>
        tx.$queryRawUnsafe(sql, ...(params ?? [])),
      ),
  )
}

/**
 * Returns a StructuralGraph backed by a direct Postgres pool.
 * Suitable for cron jobs and background workers where no tenant GUC is set.
 * The pool must already have `app.tenant_id` configured via SET session,
 * or queries must pass tenant_id explicitly (StructuralGraph does this).
 */
export function createKnowledgeGraphFromPool(pool: PgPoolLike): IKnowledgeGraph {
  return new StructuralGraph(createPostgresQueryFn(pool))
}
