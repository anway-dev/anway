import type { FastifyInstance } from 'fastify'
import { ProviderFactory, ReviewAgent, StructuralGraph } from '@anvay/agent'
import type { ProviderConfig, ReviewFindings } from '@anvay/agent'
import { TenantId } from '@anvay/types'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { requireRole } from '../plugins/rbac.js'
import { resolveProviderConfig } from './chat.js'
import { decryptJson } from '../utils/crypto.js'

const KEYLESS_PROVIDERS = new Set(['ollama', 'lmstudio'])

export async function reviewRoutes(app: FastifyInstance) {
  async function getProvider(tenantId: string) {
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
    const envConfig = resolveProviderConfig()
    if (envConfig) return ProviderFactory.create(envConfig)
    return null
  }

  app.post<{ Body: { diffSummary: string; prTitle: string } }>(
    '/api/review',
    { preHandler: [app.authenticate, requireRole('dev', 'admin')] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }
      const { diffSummary, prTitle } = request.body
      if (!diffSummary || !prTitle) return reply.code(400).send({ error: 'diffSummary and prTitle required' })

      const provider = await getProvider(tenantId)
      if (!provider) return reply.code(503).send({ error: 'No LLM provider configured' })

      const kg = new StructuralGraph((sql, params) => withTenant(prisma, tenantId, (tx) => tx.$queryRawUnsafe(sql, ...(params ?? []))))
      const agent = new ReviewAgent(provider, provider, kg)
      let findings: ReviewFindings
      try {
        findings = await agent.review(diffSummary, prTitle, TenantId(tenantId))
      } catch (err) {
        request.log.error({ err }, 'review failed')
        return reply.code(502).send({ error: 'LLM provider returned an error' })
      }
      return findings
    },
  )
}
