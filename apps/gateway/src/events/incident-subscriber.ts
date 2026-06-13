import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { SREAgent, ProviderFactory } from '@anvay/agent'
import type { ProviderConfig } from '@anvay/agent'
import { IncidentService } from '../services/incident.js'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { createKnowledgeGraph } from '../kb/index.js'
import { effectiveApiKey } from '../utils/credentials.js'
import { UUID_RE } from '../utils/validators.js'
import type { TenantId } from '@anvay/types'
import pino from 'pino'

const log = pino({ name: 'incident-subscriber' })

/** Resolve provider config: DB first (per-tenant, user-selected model), env vars as fallback. */
async function resolveProviderConfig(tenantId: string): Promise<ProviderConfig | null> {
  try {
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ provider: string; api_key_enc: string | null; base_url: string; default_model: string; cheap_model: string }>>`
        SELECT provider, api_key_enc, base_url, default_model, cheap_model
        FROM provider_config WHERE tenant_id = ${tenantId}::uuid
      `
    )
    const KEYLESS = new Set(['ollama', 'lmstudio'])
    if (rows.length > 0 && (rows[0]!.api_key_enc || KEYLESS.has(rows[0]!.provider))) {
      const r = rows[0]!
      return {
        type: r.provider as ProviderConfig['type'],
        apiKey: effectiveApiKey(r),
        baseURL: r.base_url || undefined,
        defaultModel: r.default_model || undefined,
        cheapModel: r.cheap_model || undefined,
      }
    }
  } catch { /* fall through to env vars */ }
  // Env var fallback (keyed providers first, then keyless local)
  if (process.env['ANTHROPIC_API_KEY']) return { type: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] }
  if (process.env['OPENAI_API_KEY']) return { type: 'openai', apiKey: process.env['OPENAI_API_KEY'] }
  if (process.env['GROQ_API_KEY']) return { type: 'groq', apiKey: process.env['GROQ_API_KEY'] }
  if (process.env['MISTRAL_API_KEY']) return { type: 'mistral', apiKey: process.env['MISTRAL_API_KEY'] }
  if (process.env['OLLAMA_ENDPOINT']) return { type: 'ollama', baseURL: process.env['OLLAMA_ENDPOINT'] }
  if (process.env['LMSTUDIO_ENDPOINT']) return { type: 'lmstudio', baseURL: process.env['LMSTUDIO_ENDPOINT'] }
  return null
}

export async function startIncidentSubscriber(redisUrl: string): Promise<void> {
  const incidentService = new IncidentService(prisma)

  const sub: RedisClientType = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
    },
  }) as RedisClientType

  sub.on('error', (err) => log.error({ err }, 'IncidentSubscriber Redis error'))
  await sub.connect()

  await sub.subscribe('incident_created', (message) => {
    // Non-blocking: fire-and-forget with error logging
    void (async () => {
      let payload: { id?: string; tenantId?: string; title?: string; description?: string; severity?: string }
      try {
        payload = JSON.parse(message)
      } catch {
        return
      }

      const { id, tenantId, title, description } = payload

      if (
        typeof id !== 'string' || !UUID_RE.test(id) ||
        typeof tenantId !== 'string' || !UUID_RE.test(tenantId) ||
        typeof title !== 'string'
      ) {
        log.warn({ payload }, 'incident-subscriber: invalid payload — skipping')
        return
      }

      // Resolve provider per-tenant from DB (with env fallback)
      const providerConfig = await resolveProviderConfig(tenantId)
      if (!providerConfig) {
        log.warn({ tenantId }, 'IncidentSubscriber: no LLM provider configured for tenant — skipping SRE analysis')
        return
      }
      const provider = ProviderFactory.create(providerConfig)

      try {
        const kg = createKnowledgeGraph(tenantId as TenantId)
        const sre = new SREAgent(provider, provider, kg)
        const context = await sre.assembleContext(title, description ?? '', tenantId as TenantId)
        await incidentService.setRootCause(id, tenantId, context.hypothesis)
        log.info({ incidentId: id, tenantId }, 'incident-subscriber: root cause written')
      } catch (err) {
        log.error({ err, incidentId: id, tenantId }, 'incident-subscriber: SRE analysis failed')
      }
    })()
  })

  log.info('IncidentSubscriber started — listening on incident_created')
}
