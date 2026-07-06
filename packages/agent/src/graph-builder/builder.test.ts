import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GraphBuilderAgent } from './builder.js'
import type { GraphEvent, PrMerged, DeployCompleted, IncidentCreated, TicketCreated, AlertFired } from './events.js'
import type { IKnowledgeGraph, EntitySpec, RelationshipSpec } from '../interfaces/knowledge-graph.js'
import type { IModelProvider, ChatResponse } from '../interfaces/provider.js'
import type { TenantId } from '@anway/types'

function makeMockKG(): IKnowledgeGraph {
  const entities = new Map<string, string>() // name → id
  let entityCounter = 0
  const relationships: RelationshipSpec[] = []

  return {
    upsertEntity: vi.fn(async (spec: EntitySpec): Promise<string> => {
      const key = `${spec.type}:${spec.name}`
      const existing = entities.get(key)
      if (existing) return existing
      const id = `entity-${++entityCounter}`
      entities.set(key, id)
      return id
    }),
    upsertRelationship: vi.fn(async (rel: RelationshipSpec): Promise<string> => {
      relationships.push(rel)
      return `rel-${relationships.length}`
    }),
    addEpisode: vi.fn(),
    getFacts: vi.fn(),
    getEntity: vi.fn(),
    getRelationships: vi.fn(),
    search: vi.fn(),
    resolveContext: vi.fn(),
    resolveContextByName: vi.fn(),
    getEntityByExternalRef: vi.fn(),
  } as unknown as IKnowledgeGraph
}

function makeMockModel(chatResult: string = ''): IModelProvider {
  return {
    chat: vi.fn(async (): Promise<ChatResponse> => ({
      content: chatResult,
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [],
    })),
    stream: vi.fn(),
    formatToolCall: vi.fn(() => ({ role: 'assistant' as const, content: '' })),
    formatToolResult: vi.fn(() => ({ role: 'user' as const, content: '' })),
  } as unknown as IModelProvider
}

const PR_MERGED_EVENT: PrMerged = {
  type: 'pr_merged',
  tenantId: 't-1',
  repo: 'org/payments',
  sha: 'abc1234567890',
  branch: 'main',
  message: 'Fix payments-api checkout bug',
  author: 'alice',
}

const DEPLOY_EVENT: DeployCompleted = {
  type: 'deploy_completed',
  tenantId: 't-1',
  service: 'payments-api',
  sha: 'abc1234',
  env: 'prod',
  status: 'success',
}

const INCIDENT_EVENT: IncidentCreated = {
  type: 'incident_created',
  tenantId: 't-1',
  incidentId: 'inc-001',
  title: 'Checkout failures',
  severity: 'critical',
  serviceHint: 'payments-api',
}

const ALERT_FIRED_EVENT: AlertFired = {
  type: 'alert_fired',
  tenantId: 't-1',
  incidentId: 'inc-001',
  title: 'Checkout failures',
  severity: 'critical',
  service: 'payments-api',
}

const TICKET_EVENT: TicketCreated = {
  type: 'ticket_created',
  tenantId: 't-1',
  ticketId: 'LIN-1234',
  title: 'Checkout failing since deploy',
  description: 'Users reporting 500 errors at checkout since the last deploy',
  labels: ['bug', 'payments'],
}

describe('GraphBuilderAgent', () => {
  let kg: IKnowledgeGraph
  let model: IModelProvider
  let agent: GraphBuilderAgent

  beforeEach(() => {
    kg = makeMockKG()
    model = makeMockModel('payments-api')
    agent = new GraphBuilderAgent(kg, model)
  })

  describe('handle(pr_merged)', () => {
    it('upserts Repo, Engineer, Commit entities', async () => {
      await agent.handle(PR_MERGED_EVENT)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Repo', name: 'org/payments' }),
        't-1' as TenantId,
      )
      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Engineer', name: 'alice' }),
        't-1' as TenantId,
      )
      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Commit' }),
        't-1' as TenantId,
      )
    })

    it('extracts service name and creates HOSTED_IN relationship', async () => {
      await agent.handle(PR_MERGED_EVENT)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Service', name: 'payments-api' }),
        't-1' as TenantId,
      )
      expect(kg.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'HOSTED_IN' }),
        't-1' as TenantId,
      )
    })

    // Regression test for finding I9: "fixes #N" (and closes/resolves,
    // singular/plural/past-tense variants) was never parsed at all —
    // CLAUDE.md documents this as pr_merged's Commit→FIXES→Ticket trigger.
    it('parses "fixes #N" / "closes #N" from the commit message and creates Commit→FIXES→Ticket', async () => {
      const event: PrMerged = {
        ...PR_MERGED_EVENT,
        message: 'Fixes #123 and closes #456 — checkout crash',
      }
      await agent.handle(event)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Ticket', name: 'org/payments#123' }),
        't-1' as TenantId,
      )
      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Ticket', name: 'org/payments#456' }),
        't-1' as TenantId,
      )
      expect(kg.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'FIXES' }),
        't-1' as TenantId,
      )
    })

    it('creates no FIXES relationship when the commit message has no closing keyword', async () => {
      await agent.handle(PR_MERGED_EVENT) // message: 'Fix payments-api checkout bug' — no "#N"
      expect(kg.upsertRelationship).not.toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'FIXES' }),
        't-1' as TenantId,
      )
    })
  })

  describe('handle(deploy_completed)', () => {
    it('upserts Service + Deploy + DEPLOYED_TO relationship', async () => {
      await agent.handle(DEPLOY_EVENT)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Service', name: 'payments-api' }),
        't-1' as TenantId,
      )
      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Deploy' }),
        't-1' as TenantId,
      )
      expect(kg.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'DEPLOYED_TO' }),
        't-1' as TenantId,
      )
    })

    // Regression test for finding I9: CLAUDE.md documents
    // (Deploy) -[:INTRODUCED]-> (Commit) as a canonical relationship, but it
    // was never created anywhere in the codebase.
    it('upserts Commit + creates Deploy→INTRODUCED→Commit relationship', async () => {
      await agent.handle(DEPLOY_EVENT)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Commit', name: 'abc1234' }),
        't-1' as TenantId,
      )
      expect(kg.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'INTRODUCED' }),
        't-1' as TenantId,
      )
    })
  })

  describe('handle(alert_fired)', () => {
    // Regression test for finding I9: alert_fired had no GraphEvent type and
    // no handler at all — CLAUDE.md's documented
    // (Alert) -[:TRIGGERED_BY]-> (Incident) edge could never be created,
    // and the Alert itself never became a graph entity.
    it('upserts Alert + Incident + creates TRIGGERED_BY relationship', async () => {
      await agent.handle(ALERT_FIRED_EVENT)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Alert', name: 'alert-inc-001' }),
        't-1' as TenantId,
      )
      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Incident', name: 'inc-001' }),
        't-1' as TenantId,
      )
      expect(kg.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'TRIGGERED_BY' }),
        't-1' as TenantId,
      )
    })
  })

  describe('handle(incident_created)', () => {
    it('upserts Incident + AFFECTS→Service when serviceHint present', async () => {
      await agent.handle(INCIDENT_EVENT)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Incident', name: 'inc-001' }),
        't-1' as TenantId,
      )
      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Service', name: 'payments-api' }),
        't-1' as TenantId,
      )
      expect(kg.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'AFFECTS' }),
        't-1' as TenantId,
      )
    })
  })

  describe('handle(ticket_created)', () => {
    it('upserts Ticket + RELATES_TO→Service relationship', async () => {
      await agent.handle(TICKET_EVENT)

      expect(kg.upsertEntity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Ticket', name: 'LIN-1234' }),
        't-1' as TenantId,
      )
      expect(kg.upsertRelationship).toHaveBeenCalledWith(
        expect.objectContaining({ relType: 'RELATES_TO' }),
        't-1' as TenantId,
      )
    })

    it('scores confidence 0.9 / unconfirmed false when service name is mentioned verbatim', async () => {
      // Model extracts "payments-api"; title contains it verbatim → high confidence
      const verbatimEvent: TicketCreated = {
        type: 'ticket_created',
        tenantId: 't-1',
        ticketId: 'LIN-2000',
        title: 'payments-api checkout failing',
        description: 'Users reporting 500 errors at checkout',
        labels: ['bug'],
      }
      await agent.handle(verbatimEvent)

      const relCall = (kg.upsertRelationship as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0] as RelationshipSpec)
        .find((r) => r.relType === 'RELATES_TO')
      expect(relCall).toBeDefined()
      expect(relCall?.metadata).toMatchObject({ confidence: 0.9, unconfirmed: false })
    })

    it('scores confidence 0.6 / unconfirmed true when extracted name is not in the text', async () => {
      // Model infers "billing-svc" but it never appears in the ticket text → low confidence
      const inferredModel = makeMockModel('billing-svc')
      const inferringAgent = new GraphBuilderAgent(kg, inferredModel)
      const inferredEvent: TicketCreated = {
        type: 'ticket_created',
        tenantId: 't-1',
        ticketId: 'LIN-3000',
        title: 'Checkout failing since deploy',
        description: 'Users reporting 500 errors at checkout',
        labels: ['bug'],
      }
      await inferringAgent.handle(inferredEvent)

      const relCall = (kg.upsertRelationship as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => c[0] as RelationshipSpec)
        .find((r) => r.relType === 'RELATES_TO')
      expect(relCall).toBeDefined()
      expect(relCall?.metadata).toMatchObject({ confidence: 0.6, unconfirmed: true })
    })
  })

  describe('extractServiceName', () => {
    it('returns trimmed model response when non-empty', async () => {
      const name = await agent.extractServiceName('fix payments-api bug', 't-1' as TenantId)
      expect(name).toBe('payments-api')
    })

    it('returns null when model returns empty string', async () => {
      const emptyModel = makeMockModel('')
      const a = new GraphBuilderAgent(kg, emptyModel)
      const name = await a.extractServiceName('no service here', 't-1' as TenantId)
      expect(name).toBeNull()
    })
  })

  describe('error handling', () => {
    it('does not throw when kg throws — logs and swallows', async () => {
      const mockLogger = { error: vi.fn(), warn: vi.fn() }
      const badKg = { ...kg, upsertEntity: vi.fn().mockRejectedValue(new Error('DB down')) } as unknown as IKnowledgeGraph
      const resilient = new GraphBuilderAgent(badKg, model, mockLogger)

      await expect(resilient.handle(PR_MERGED_EVENT)).resolves.toBeUndefined()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), eventType: 'pr_merged' }),
        'GraphBuilderAgent event handling failed',
      )
    })

    it('works without logger (backwards compatible)', async () => {
      const badKg = { ...kg, upsertEntity: vi.fn().mockRejectedValue(new Error('DB down')) } as unknown as IKnowledgeGraph
      const resilient = new GraphBuilderAgent(badKg, model)

      await expect(resilient.handle(PR_MERGED_EVENT)).resolves.toBeUndefined()
    })
  })
})
