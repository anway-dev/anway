import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock redis before importing the module
const mockSubscribe = vi.fn()
const mockConnect = vi.fn()
vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: mockConnect,
    subscribe: mockSubscribe,
    on: vi.fn(),
  })),
}))

// Mock kb/index
const mockCreateKG = vi.fn()
vi.mock('../kb/index.js', () => ({
  createKnowledgeGraph: (...args: unknown[]) => mockCreateKG(...args),
}))

// Mock db/client — prisma may auto-connect if DATABASE_URL is set from .env
vi.mock('../db/client.js', () => {
  const mockTx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    $executeRaw: vi.fn(() => Promise.resolve(0)),
  }
  return {
    prisma: {
      $queryRaw: mockTx.$queryRaw,
      $executeRaw: mockTx.$executeRaw,
    },
  }
})

// Mock db/prisma — withTenant calls the callback with a mock tx
vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_prisma: unknown, _tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    return fn({ $queryRaw: vi.fn(() => Promise.resolve([])), $executeRaw: vi.fn(() => Promise.resolve(0)) })
  }),
}))

// Mock @anway/agent
const mockHandle = vi.fn()
vi.mock('@anway/agent', () => ({
  GraphBuilderAgent: vi.fn(function (this: Record<string, unknown>) {
    this.handle = mockHandle
    return this
  }),
  ProviderFactory: {
    create: vi.fn(() => ({ type: 'anthropic', apiKey: 'test-key' })),
  },
}))

// Mock new T14 connector bootstrap packages — not yet built to dist
vi.mock('@anway/connector-aws-health', () => ({
  AwsHealthBootstrap: vi.fn(function (this: Record<string, unknown>) { return this }),
}))
vi.mock('@anway/connector-azure-monitor', () => ({
  AzureMonitorBootstrap: vi.fn(function (this: Record<string, unknown>) { return this }),
}))
vi.mock('@anway/connector-gcp-monitoring', () => ({
  GcpMonitoringBootstrap: vi.fn(function (this: Record<string, unknown>) { return this }),
}))

import { startGraphBuilderSubscriber } from './subscriber.js'

describe('startGraphBuilderSubscriber', () => {
  const mockLog = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips events when no LLM provider configured', async () => {
    // Provider is resolved per-event (DB first, env fallback) — warn fires on event arrival.
    // Must clear ALL LLM env vars — vitest loads .env which may set OLLAMA_ENDPOINT.
    const cleared = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'OLLAMA_ENDPOINT', 'LMSTUDIO_ENDPOINT']
    const prev: Record<string, string | undefined> = {}
    for (const k of cleared) { prev[k] = process.env[k]; delete process.env[k] }

    await startGraphBuilderSubscriber('redis://localhost:6379', mockLog as any)
    const callback = mockSubscribe.mock.calls[0]?.[1] as (msg: string) => Promise<void>
    await callback('{"type":"pr_merged","tenantId":"00000000-0000-0000-0000-000000000001"}')

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '00000000-0000-0000-0000-000000000001' }),
      'GraphBuilderSubscriber: no LLM provider configured — skipping',
    )
    expect(mockHandle).not.toHaveBeenCalled()

    for (const k of cleared) { if (prev[k] !== undefined) process.env[k] = prev[k] }
  })

  it('subscribes to all 7 graph event channels plus kb:stale', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key'
    await startGraphBuilderSubscriber('redis://localhost:6379', mockLog as any)

    expect(mockSubscribe).toHaveBeenCalledTimes(8)
    const channels = mockSubscribe.mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toContain('pr_merged')
    expect(channels).toContain('deploy_completed')
    expect(channels).toContain('incident_created')
    expect(channels).toContain('ticket_created')
    expect(channels).toContain('connector_registered')
    expect(channels).toContain('connector_removed')
    expect(channels).toContain('connector_reconnected')
    expect(channels).toContain('kb:stale')
    expect(mockLog.info).toHaveBeenCalled()
  })

  it('skips messages with invalid tenantId', async () => {
    // Get the subscribe callback from the first call
    process.env['ANTHROPIC_API_KEY'] = 'test-key'
    await startGraphBuilderSubscriber('redis://localhost:6379', mockLog as any)

    const callback = mockSubscribe.mock.calls[0]?.[1] as (msg: string) => Promise<void>
    expect(callback).toBeDefined()

    // Invalid: not a UUID
    await callback('{"type":"pr_merged","tenantId":"not-a-uuid"}')
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'not-a-uuid' }),
      'graph-builder subscriber: invalid tenantId — skipping',
    )
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('calls agent.handle() for valid events', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key'
    await startGraphBuilderSubscriber('redis://localhost:6379', mockLog as any)

    const callback = mockSubscribe.mock.calls[0]?.[1] as (msg: string) => Promise<void>

    const validEvent = {
      type: 'pr_merged',
      tenantId: '00000000-0000-0000-0000-000000000001',
      repo: 'org/test',
      sha: 'abc1234',
      branch: 'main',
      message: 'test',
      author: 'alice',
    }
    await callback(JSON.stringify(validEvent))
    expect(mockHandle).toHaveBeenCalledTimes(1)
    expect(mockHandle).toHaveBeenCalledWith(expect.objectContaining({ type: 'pr_merged' }))
  })
})
