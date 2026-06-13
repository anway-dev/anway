import type { FastifyInstance } from 'fastify'
import { ProviderFactory, ProductAgent, TechSpecAgent, StructuralGraph } from '@anvay/agent'
import type { ProviderConfig, IKnowledgeGraph } from '@anvay/agent'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { decryptJson } from '../utils/crypto.js'

const KEYLESS_PROVIDERS = new Set(['ollama', 'lmstudio'])

export async function lifecycleRoutes(app: FastifyInstance) {
  async function getProvider(tenantId: string) {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ provider: string; api_key_enc: string | null; api_key: string | null; base_url: string | null; default_model: string | null; cheap_model: string | null }>>`
        SELECT provider, api_key_enc, api_key, base_url, default_model, cheap_model
        FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    ).catch(() => [])

    if (rows.length > 0 && (rows[0]!.api_key_enc || rows[0]!.api_key || KEYLESS_PROVIDERS.has(rows[0]!.provider))) {
      const r = rows[0]!
      return ProviderFactory.create({
        type: r.provider as ProviderConfig['type'],
        apiKey: r.api_key_enc ? decryptJson<string>(r.api_key_enc) : (r.api_key ?? undefined),
        baseURL: r.base_url || undefined,
        defaultModel: r.default_model || undefined,
        cheapModel: r.cheap_model || undefined,
      })
    }
    return null
  }

  app.post<{ Body: { featureRequest: string } }>(
    '/api/lifecycle/prd',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { featureRequest } = request.body
      if (!featureRequest) return reply.code(400).send({ error: 'featureRequest required' })

      const provider = await getProvider(tenantId)
      if (!provider) return reply.code(503).send({ error: 'No LLM provider configured' })

      const kg: IKnowledgeGraph = new StructuralGraph(
        (sql, params) => withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))),
      )
      const agent = new ProductAgent(provider, provider, kg)
      const prd = await agent.writePRD(featureRequest, tenantId as unknown as 'TenantId')
      const title = prd.title || featureRequest

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO artifacts (tenant_id, kind, title, content, status)
          VALUES (${tenantId}::uuid, 'prd', ${title}, ${JSON.stringify(prd)}::jsonb, 'draft')
          RETURNING id
        `
      ).catch(() => [])
      return { id: rows[0]?.id, prd }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/lifecycle/prd/:id/approve',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const affected = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE artifacts SET status = 'approved', updated_at = NOW()
          WHERE id = ${request.params.id}::uuid AND kind = 'prd' AND tenant_id = ${tenantId}::uuid
        `
      )
      if (Number(affected) === 0) return reply.code(404).send({ error: 'PRD not found' })
      return { ok: true }
    },
  )

  app.post<{ Body: { prdId: string } }>(
    '/api/lifecycle/techspec',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { prdId } = request.body

      const prdRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ content: Record<string, unknown> }>>`
          SELECT content FROM artifacts WHERE id = ${prdId}::uuid AND kind = 'prd' AND status = 'approved' AND tenant_id = ${tenantId}::uuid
        `
      ).catch(() => [])
      if (prdRows.length === 0) return reply.code(404).send({ error: 'Approved PRD not found' })

      const provider = await getProvider(tenantId)
      if (!provider) return reply.code(503).send({ error: 'No LLM provider configured' })

      const prd = prdRows[0]!.content as unknown as { title: string; problem: string; goals: string[]; nonGoals: string[]; userStories: unknown[]; successMetrics: string[]; openQuestions: string[] }
      const kg: IKnowledgeGraph = new StructuralGraph(
        (sql, params) => withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))),
      )
      const agent = new TechSpecAgent(provider, provider, kg)
      const techspec = await agent.writeTechSpec(prd, tenantId as unknown as 'TenantId')

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO artifacts (tenant_id, kind, title, content, status, parent_id)
          VALUES (${tenantId}::uuid, 'techspec', ${techspec.title || prd.title}, ${JSON.stringify(techspec)}::jsonb, 'draft', ${prdId}::uuid)
          RETURNING id
        `
      ).catch(() => [])
      return { id: rows[0]?.id, techspec }
    },
  )

  app.get('/api/lifecycle/artifacts', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string; kind: string; title: string; status: string; parent_id: string | null; created_at: Date }>>`
        SELECT id, kind, title, status, parent_id, created_at FROM artifacts ORDER BY created_at DESC LIMIT 50
      `
    ).catch(() => [])
    return rows.map(r => ({
      id: r.id, kind: r.kind, title: r.title, status: r.status,
      parentId: r.parent_id, createdAt: r.created_at,
    }))
  })
}
