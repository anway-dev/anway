import type { FastifyInstance } from 'fastify'
import { ProviderFactory, ProductAgent, TechSpecAgent, BootstrapAgent, TestAgent, StructuralGraph } from '@anvay/agent'
import type { ProviderConfig, IKnowledgeGraph } from '@anvay/agent'
import type { PRD, TechSpec, BootstrapPlan, TestPlan, TestFile } from '@anvay/agent'
import { TenantId } from '@anvay/types'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { providerConfigFromEnv, resolveProviderConfig } from './chat.js'
import { requireRole } from '../plugins/rbac.js'
import { appendAuditEvent } from './audit.js'
import { decryptJson } from '../utils/crypto.js'

const KEYLESS_PROVIDERS = new Set(['ollama', 'lmstudio'])

export async function lifecycleRoutes(app: FastifyInstance) {
  async function getProvider(tenantId: string) {
    // DB-first (api_key_enc only — plaintext api_key dropped in S1.4), env fallback.
    const row = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ provider: string; api_key_enc: string | null; base_url: string | null; default_model: string | null; cheap_model: string | null }>>`
        SELECT provider, api_key_enc, base_url, default_model, cheap_model
        FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    ).catch(() => [])
    if (row.length > 0 && (row[0]!.api_key_enc || KEYLESS_PROVIDERS.has(row[0]!.provider))) {
      const r = row[0]!
      return ProviderFactory.create({
        type: r.provider as ProviderConfig['type'],
        apiKey: r.api_key_enc ? decryptJson<string>(r.api_key_enc) : undefined,
        baseURL: r.base_url || undefined,
        defaultModel: r.default_model || undefined,
        cheapModel: r.cheap_model || undefined,
      })
    }
    // Env fallback for dev — same provider ordering as chat.ts
    const envConfig = resolveProviderConfig()
    if (envConfig) return ProviderFactory.create(envConfig)
    return null
  }

  app.post<{ Body: { featureRequest: string } }>(
    '/api/lifecycle/prd',
    { preHandler: [app.authenticate, requireRole('pm', 'admin')] },
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
      let prd: PRD
      try {
        prd = await agent.writePRD(featureRequest, TenantId(tenantId))
      } catch (err) {
        request.log.error({ err }, 'writePRD failed')
        return reply.code(502).send({ error: 'LLM provider returned an error' })
      }
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
    { preHandler: [app.authenticate, requireRole('pm', 'admin')] },
    async (request, reply) => {
      const { tenantId, sub: userId, role } = request.user as { tenantId: string; sub: string; role: string }
      const { id } = request.params
      const affected = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE artifacts SET status = 'approved', updated_at = NOW()
          WHERE id = ${id}::uuid AND kind = 'prd' AND tenant_id = ${tenantId}::uuid
        `
      )
      if (Number(affected) === 0) return reply.code(404).send({ error: 'PRD not found' })
      await appendAuditEvent({
        tenantId, userId,
        action: 'gate_approved',
        resource: `prd:${id}`,
        outcome: 'action_executed',
        metadata: { artifactId: id, role, kind: 'prd' },
      }).catch(() => {})
      return { ok: true }
    },
  )

  app.post<{ Body: { prdId: string } }>(
    '/api/lifecycle/techspec',
    { preHandler: [app.authenticate, requireRole('dev', 'pm', 'admin')] },
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

      const prd = prdRows[0]!.content as unknown as PRD
      const kg: IKnowledgeGraph = new StructuralGraph(
        (sql, params) => withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))),
      )
      const agent = new TechSpecAgent(provider, provider, kg)
      let techspec: { title: string }
      try {
        techspec = await agent.writeTechSpec(prd, TenantId(tenantId))
      } catch (err) {
        request.log.error({ err }, 'writeTechSpec failed')
        return reply.code(502).send({ error: 'LLM provider returned an error' })
      }

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

  app.post<{ Params: { id: string } }>(
    '/api/lifecycle/techspec/:id/approve',
    { preHandler: [app.authenticate, requireRole('pm', 'admin')] },
    async (request, reply) => {
      const { tenantId, sub: userId, role } = request.user as { tenantId: string; sub: string; role: string }
      const { id } = request.params
      const affected = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE artifacts SET status = 'approved', updated_at = NOW()
          WHERE id = ${id}::uuid AND kind = 'techspec' AND tenant_id = ${tenantId}::uuid
        `
      )
      if (Number(affected) === 0) return reply.code(404).send({ error: 'TechSpec not found' })
      await appendAuditEvent({
        tenantId, userId,
        action: 'gate_approved',
        resource: `techspec:${id}`,
        outcome: 'action_executed',
        metadata: { artifactId: id, role, kind: 'techspec' },
      }).catch(() => {})
      return { ok: true }
    },
  )

  // AW-T1 — BootstrapAgent.planBootstrap
  app.post<{ Body: { techspecId: string } }>(
    '/api/lifecycle/bootstrap',
    { preHandler: [app.authenticate, requireRole('dev', 'admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { techspecId } = request.body
      if (!techspecId) return reply.code(400).send({ error: 'techspecId required' })

      const tsRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ content: Record<string, unknown> }>>`
          SELECT content FROM artifacts
          WHERE id = ${techspecId}::uuid AND kind = 'techspec' AND status = 'approved'
            AND tenant_id = ${tenantId}::uuid
        `
      ).catch(() => [])
      if (tsRows.length === 0) return reply.code(404).send({ error: 'Approved TechSpec not found' })

      const provider = await getProvider(tenantId)
      if (!provider) return reply.code(503).send({ error: 'No LLM provider configured' })

      const spec = tsRows[0]!.content as unknown as TechSpec
      const kg = new StructuralGraph((sql, params) => withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))))
      const agent = new BootstrapAgent(provider, provider, kg)
      let plan: BootstrapPlan
      try {
        plan = await agent.planBootstrap(spec, TenantId(tenantId))
      } catch (err) {
        request.log.error({ err }, 'planBootstrap failed')
        return reply.code(502).send({ error: 'LLM provider returned an error' })
      }

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO artifacts (tenant_id, kind, title, content, status, parent_id)
          VALUES (${tenantId}::uuid, 'bootstrap_plan', ${plan.service}, ${JSON.stringify(plan)}::jsonb, 'draft', ${techspecId}::uuid)
          RETURNING id
        `
      ).catch(() => [])
      return { id: rows[0]?.id, plan }
    },
  )

  // AW-T3 — TestAgent.writeTestPlan
  app.post<{ Body: { techspecId: string } }>(
    '/api/lifecycle/testplan',
    { preHandler: [app.authenticate, requireRole('dev', 'admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { techspecId } = request.body
      if (!techspecId) return reply.code(400).send({ error: 'techspecId required' })

      const tsRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ content: Record<string, unknown> }>>`
          SELECT content FROM artifacts WHERE id = ${techspecId}::uuid AND kind = 'techspec' AND tenant_id = ${tenantId}::uuid
        `
      ).catch(() => [])
      if (tsRows.length === 0) return reply.code(404).send({ error: 'TechSpec not found' })

      const provider = await getProvider(tenantId)
      if (!provider) return reply.code(503).send({ error: 'No LLM provider configured' })

      const spec = tsRows[0]!.content as unknown as TechSpec
      const kg = new StructuralGraph((sql, params) => withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))))
      const agent = new TestAgent(provider, provider, kg)
      let plan: TestPlan
      try {
        plan = await agent.writeTestPlan(spec, TenantId(tenantId))
      } catch (err) {
        request.log.error({ err }, 'writeTestPlan failed')
        return reply.code(502).send({ error: 'LLM provider returned an error' })
      }

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO artifacts (tenant_id, kind, title, content, status, parent_id)
          VALUES (${tenantId}::uuid, 'test_plan', ${'Test plan for ' + spec.title}, ${JSON.stringify(plan)}::jsonb, 'draft', ${techspecId}::uuid)
          RETURNING id
        `
      ).catch(() => [])
      return { id: rows[0]?.id, plan }
    },
  )

  // AW-T3 — TestAgent.writeRegressionTest
  app.post<{ Body: { incident: string } }>(
    '/api/lifecycle/regression-test',
    { preHandler: [app.authenticate, requireRole('dev', 'admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { incident } = request.body
      if (!incident) return reply.code(400).send({ error: 'incident required' })

      const provider = await getProvider(tenantId)
      if (!provider) return reply.code(503).send({ error: 'No LLM provider configured' })

      const kg = new StructuralGraph((sql, params) => withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))))
      const agent = new TestAgent(provider, provider, kg)
      let testFile: TestFile
      try {
        testFile = await agent.writeRegressionTest(incident, TenantId(tenantId))
      } catch (err) {
        request.log.error({ err }, 'writeRegressionTest failed')
        return reply.code(502).send({ error: 'LLM provider returned an error' })
      }
      return testFile
    },
  )

  app.get('/api/lifecycle/artifacts', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string; kind: string; title: string; status: string; parent_id: string | null; created_at: Date }>>`
        SELECT id, kind, title, status, parent_id, created_at FROM artifacts WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 50
      `
    ).catch(() => [])
    return rows.map(r => ({
      id: r.id, kind: r.kind, title: r.title, status: r.status,
      parentId: r.parent_id, createdAt: r.created_at,
    }))
  })
}
