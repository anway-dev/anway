import { StructuralGraph, createPostgresQueryFn, HybridKnowledgeGraph, GraphitiClient } from '@anway/agent'
import type { PgPoolLike, IKnowledgeGraph, IEmbeddingProvider } from '@anway/agent'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import type { TenantId } from '@anway/types'

/**
 * Returns the IKnowledgeGraph implementation for the given tenant.
 *
 * When AGENT_SERVICE_URL is set: HybridKnowledgeGraph (structural + episodic via Graphiti).
 * Without it: pure StructuralGraph (entities/relationships only, no temporal search).
 *
 * @param embedder — optional embedding provider for pgvector semantic search.
 * When provided, StructuralGraph.search() uses vector similarity instead of ILIKE fallback.
 */
export function createKnowledgeGraph(tenantId: TenantId, embedder?: IEmbeddingProvider): IKnowledgeGraph {
  const structural = new StructuralGraph(
    (sql: string, params?: unknown[]) =>
      withTenant(prisma, tenantId, (tx) =>
        tx.$queryRawUnsafe(sql, ...(params ?? [])),
      ),
    embedder,
  )

  const agentServiceUrl = process.env['AGENT_SERVICE_URL']
  if (agentServiceUrl) {
    const graphiti = new GraphitiClient({ baseUrl: agentServiceUrl, tenantId })
    return new HybridKnowledgeGraph(structural, graphiti)
  }

  return structural
}

/**
 * Returns a StructuralGraph backed by a direct Postgres pool.
 * Suitable for cron jobs and background workers where no tenant GUC is set.
 */
export function createKnowledgeGraphFromPool(pool: PgPoolLike): IKnowledgeGraph {
  return new StructuralGraph(createPostgresQueryFn(pool))
}
