import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { ArgocdAgent } from './agent.js'

// ── Realistic ArgoCD API fixtures ───────────────────────────────────

const appsFixture = {
  items: [
    {
      metadata: { name: 'payments-api', namespace: 'prod' },
      spec: { source: { repoURL: 'https://github.com/org/payments', path: 'k8s' } },
      status: {
        sync: { status: 'Synced' },
        health: { status: 'Healthy' },
        history: [
          { id: 14, revision: 'a1b2c3d4e5f6', deployedAt: '2026-07-04T10:30:00Z', deployStartedAt: '2026-07-04T10:29:30Z' },
          { id: 13, revision: 'f6e5d4c3b2a1', deployedAt: '2026-07-04T09:15:00Z', deployStartedAt: '2026-07-04T09:14:30Z' },
        ],
      },
    },
    {
      metadata: { name: 'auth-service', namespace: 'prod' },
      spec: { source: { repoURL: 'https://github.com/org/auth', path: 'k8s' } },
      status: {
        sync: { status: 'OutOfSync' },
        health: { status: 'Degraded' },
        history: [
          { id: 8, revision: 'b2c3d4e5f6a1', deployedAt: '2026-07-04T08:00:00Z', deployStartedAt: '2026-07-04T07:59:30Z' },
        ],
      },
    },
    {
      metadata: { name: 'checkout-api', namespace: 'prod' },
      spec: { source: { repoURL: 'https://github.com/org/checkout', path: 'k8s' } },
      status: {
        sync: { status: 'Synced' },
        health: { status: 'Progressing' },
        history: [],
      },
    },
    {
      metadata: { name: 'notifications-worker', namespace: 'prod' },
      spec: { source: { repoURL: 'https://github.com/org/notifications', path: 'k8s' } },
      status: {
        sync: { status: 'Unknown' },
        health: { status: 'Suspended' },
        history: [],
      },
    },
    {
      metadata: { name: 'legacy-monolith', namespace: 'prod' },
      spec: { source: { repoURL: 'https://github.com/org/legacy', path: 'k8s' } },
      status: {
        sync: { status: 'Synced' },
        health: { status: 'Degraded' },
        history: [
          { id: 3, revision: 'deadbeef1234', deployedAt: '2026-06-15T12:00:00Z', deployStartedAt: '2026-06-15T11:59:00Z' },
        ],
      },
    },
  ],
}

const paymentsAppFixture = appsFixture.items[0]!

const fixtureRoutes: FixtureRoute[] = [
  // List all applications
  { method: 'GET', path: '/api/v1/applications', status: 200, body: appsFixture },
  // Individual app lookups for get_builds
  { method: 'GET', path: '/api/v1/applications/payments-api', status: 200, body: paymentsAppFixture },
  { method: 'GET', path: '/api/v1/applications/auth-service', status: 200, body: appsFixture.items[1]! },
  { method: 'GET', path: '/api/v1/applications/checkout-api', status: 200, body: appsFixture.items[2]! },
  { method: 'GET', path: '/api/v1/applications/nonexistent', status: 404, body: { error: 'not found', code: 5, message: 'application not found' } },
  { method: 'GET', path: '/api/v1/applications/crash', status: 500, body: {} },
]

describe('argocd — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  // ── get_pipelines ──────────────────────────────────────────────────

  it('get_pipelines returns real parsed data from fixture', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      {},
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { pipelines: Array<{ id: string; name: string; status: string; syncStatus: string; healthStatus: string }> }

    expect(result.pipelines).toHaveLength(5)

    // payments-api: Synced + Healthy → healthy
    expect(result.pipelines[0]).toMatchObject({
      id: 'payments-api', name: 'payments-api',
      status: 'healthy', syncStatus: 'Synced', healthStatus: 'Healthy',
    })

    // auth-service: OutOfSync + Degraded → out_of_sync
    expect(result.pipelines[1]).toMatchObject({
      id: 'auth-service', status: 'out_of_sync', syncStatus: 'OutOfSync',
    })

    // checkout-api: Synced + Progressing → progressing
    expect(result.pipelines[2]).toMatchObject({
      id: 'checkout-api', status: 'progressing',
    })

    // notifications-worker: Unknown + Suspended → suspended
    expect(result.pipelines[3]).toMatchObject({
      id: 'notifications-worker', status: 'suspended',
    })

    // legacy-monolith: Synced + Degraded → degraded
    expect(result.pipelines[4]).toMatchObject({
      id: 'legacy-monolith', status: 'degraded',
    })
  })

  it('get_pipelines filters by service param (case-insensitive)', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    const result = await tool.execute(
      { service: 'payments' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { pipelines: Array<{ id: string }> }

    expect(result.pipelines).toHaveLength(1)
    expect(result.pipelines[0].id).toBe('payments-api')
  })

  it('get_pipelines filter is case-insensitive', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    const result = await tool.execute(
      { service: 'AUTH' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { pipelines: Array<{ id: string }> }

    expect(result.pipelines).toHaveLength(1)
    expect(result.pipelines[0].id).toBe('auth-service')
  })

  it('get_pipelines with no service param returns all', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    const result = await tool.execute(
      { service: undefined },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { pipelines: Array<{ id: string }> }

    expect(result.pipelines).toHaveLength(5)
  })

  it('get_pipelines returns empty on missing creds', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    const result = await tool.execute({}, {}) as { pipelines: unknown[] }
    expect(result.pipelines).toEqual([])
  })

  it('get_pipelines returns empty when baseUrl is 500', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    // Point at a port that doesn't respond → connection refused → caught → empty
    const result = await tool.execute(
      {},
      { baseUrl: 'http://127.0.0.1:1', token: 'fixture-token' },
    ) as { pipelines: unknown[] }
    expect(result.pipelines).toEqual([])
  })

  // ── get_builds ─────────────────────────────────────────────────────

  it('get_builds returns deployment history from status.history', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { pipeline: 'payments-api' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { builds: Array<{ id: string; sha: string; status: string; duration: number; startedAt: string }> }

    expect(result.builds).toHaveLength(2)

    // Most recent first (ArgoCD returns history in order)
    expect(result.builds[0]).toMatchObject({
      id: 'b-14',
      sha: 'a1b2c3d4e5f6',
      status: 'deployed',
      duration: 0,
      startedAt: '2026-07-04T10:30:00Z',
    })
    expect(result.builds[1]).toMatchObject({
      id: 'b-13',
      sha: 'f6e5d4c3b2a1',
      startedAt: '2026-07-04T09:15:00Z',
    })
  })

  it('get_builds respects limit param', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!

    const result = await tool.execute(
      { pipeline: 'payments-api', limit: 1 },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { builds: Array<{ id: string }> }

    expect(result.builds).toHaveLength(1)
    expect(result.builds[0].id).toBe('b-14')
  })

  it('get_builds returns empty builds for app with no history', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!

    const result = await tool.execute(
      { pipeline: 'checkout-api' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { builds: unknown[] }

    expect(result.builds).toEqual([])
  })

  it('get_builds returns empty for nonexistent app (404)', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!

    const result = await tool.execute(
      { pipeline: 'nonexistent' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { builds: unknown[] }

    expect(result.builds).toEqual([])
  })

  it('get_builds returns empty on missing creds', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!

    const result = await tool.execute({ pipeline: 'test' }, {}) as { builds: unknown[] }
    expect(result.builds).toEqual([])
  })

  // ── trigger_deploy — unchanged, verify it still works ──────────────

  it('trigger_deploy is still present and write=true', async () => {
    const agent = new ArgocdAgent()
    const tool = agent.tools.find(t => t.definition.name === 'trigger_deploy')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(true)
  })

  // ── request tracking ───────────────────────────────────────────────

  it('fixture server received pipeline + build requests', () => {
    const paths = fixture.receivedRequests.map(r => r.path.split('?')[0]!)
    expect(
      paths.some(p => p === '/api/v1/applications'),
      'expected GET /api/v1/applications call',
    ).toBe(true)
    expect(
      paths.some(p => p === '/api/v1/applications/payments-api'),
      'expected GET /api/v1/applications/payments-api call',
    ).toBe(true)
  })
})
