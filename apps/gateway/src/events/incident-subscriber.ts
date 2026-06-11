import { createClient } from 'redis'
import type { RedisClientType } from 'redis'
import { SREAgent, ProviderFactory } from '@anvay/agent'
import type { ProviderConfig } from '@anvay/agent'
import { IncidentService } from '../services/incident.js'
import { prisma } from '../db/client.js'
import { createKnowledgeGraph } from '../kb/index.js'
import { UUID_RE } from '../utils/validators.js'
import type { TenantId } from '@anvay/types'
import pino from 'pino'

const log = pino({ name: 'incident-subscriber' })

function resolveProviderConfig(): ProviderConfig | null {
  if (process.env['ANTHROPIC_API_KEY']) return { type: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] }
  if (process.env['OPENAI_API_KEY']) return { type: 'openai', apiKey: process.env['OPENAI_API_KEY'] }
  if (process.env['GROQ_API_KEY']) return { type: 'groq', apiKey: process.env['GROQ_API_KEY'] }
  if (process.env['MISTRAL_API_KEY']) return { type: 'mistral', apiKey: process.env['MISTRAL_API_KEY'] }
  return null
}

export async function startIncidentSubscriber(redisUrl: string): Promise<void> {
  const providerConfig = resolveProviderConfig()
  if (!providerConfig) {
    log.warn('IncidentSubscriber: no LLM provider configured — SRE root cause analysis disabled')
    return
  }

  const provider = ProviderFactory.create(providerConfig)
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
