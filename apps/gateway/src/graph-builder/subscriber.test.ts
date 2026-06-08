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

// Mock @anvay/agent
const mockHandle = vi.fn()
vi.mock('@anvay/agent', () => ({
  GraphBuilderAgent: vi.fn(function (this: Record<string, unknown>) {
    this.handle = mockHandle
    return this
  }),
  ProviderFactory: {
    create: vi.fn(() => ({ type: 'anthropic', apiKey: 'test-key' })),
  },
}))

import { startGraphBuilderSubscriber } from './subscriber.js'

describe('startGraphBuilderSubscriber', () => {
  const mockLog = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips when no LLM provider configured', async () => {
    // Temporarily unset env vars for this test
    const prev = { ...process.env }
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['OPENAI_API_KEY']
    delete process.env['GROQ_API_KEY']

    await startGraphBuilderSubscriber('redis://localhost:6379', mockLog as any)
    expect(mockLog.warn).toHaveBeenCalledWith(
      'GraphBuilderSubscriber: no LLM provider configured — skipping',
    )

    Object.assign(process.env, prev)
  })

  it('subscribes to all 5 graph event channels when provider available', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key'
    await startGraphBuilderSubscriber('redis://localhost:6379', mockLog as any)

    expect(mockSubscribe).toHaveBeenCalledTimes(5)
    const channels = mockSubscribe.mock.calls.map((c: unknown[]) => c[0])
    expect(channels).toContain('pr_merged')
    expect(channels).toContain('deploy_completed')
    expect(channels).toContain('incident_created')
    expect(channels).toContain('ticket_created')
    expect(channels).toContain('connector_registered')
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
