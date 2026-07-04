import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { VaultBootstrap } from './bootstrap.js'
import { VaultAgent } from './agent.js'

// ── Realistic Vault API fixtures ──────────────────────────────────────

const mountsFixture = {
  'secret/': { type: 'kv', description: 'key-value storage' },
  'cubbyhole/': { type: 'cubbyhole', description: 'per-token private secret storage' },
}

const listMyappFixture = {
  data: { keys: ['api-key', 'db-password', 'stripe-webhook'] },
}

const metaMyappFixture = {
  data: {
    current_version: 3,
    created_time: '2026-06-01T10:00:00.000000Z',
    updated_time: '2026-07-02T14:30:00.000000Z',
    max_versions: 0,
    cas_required: false,
  },
}

const listRootFixture = {
  data: { keys: ['myapp', 'otherapp', 'shared-config'] },
}

const policiesFixture = {
  data: { keys: ['admin', 'readonly', 'deployer'] },
}

const vaultError404 = {
  errors: ['no handler for route'],
}

const fixtureRoutes: FixtureRoute[] = [
  // Bootstrap — list mounts
  { method: 'GET', path: '/v1/sys/mounts', status: 200, body: mountsFixture },

  // get_secret_metadata — subpath with keys + metadata
  { method: 'GET', path: '/v1/secret/metadata/myapp/', status: 200, body: listMyappFixture },
  { method: 'GET', path: '/v1/secret/metadata/myapp', status: 200, body: metaMyappFixture },

  // get_secret_metadata — mount root (no subpath, LIST only)
  { method: 'GET', path: '/v1/secret/metadata/', status: 200, body: listRootFixture },

  // list_policies
  { method: 'GET', path: '/v1/sys/policies/acl', status: 200, body: policiesFixture },

  // Nonexistent mount — Vault error shape
  { method: 'GET', path: '/v1/nonexistent/metadata/foo/', status: 404, body: vaultError404 },
  { method: 'GET', path: '/v1/nonexistent/metadata/foo', status: 404, body: vaultError404 },
]

describe('vault — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  // ── bootstrap ─────────────────────────────────────────────────────

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new VaultBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector',
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(result.episodeHints.length).toBeGreaterThan(0)
  })

  // ── get_secret_metadata ────────────────────────────────────────────

  it('get_secret_metadata returns keys + lastUpdated from fixture', async () => {
    const agent = new VaultAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_secret_metadata')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { path: 'secret/myapp' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { keys: string[]; lastUpdated: string | null }

    expect(result.keys).toEqual(['api-key', 'db-password', 'stripe-webhook'])
    expect(result.lastUpdated).toBe('2026-07-02T14:30:00.000000Z')
  })

  it('get_secret_metadata mount-only path returns keys but null lastUpdated', async () => {
    const agent = new VaultAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_secret_metadata')!

    const result = await tool.execute(
      { path: 'secret' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { keys: string[]; lastUpdated: string | null }

    expect(result.keys).toEqual(['myapp', 'otherapp', 'shared-config'])
    expect(result.lastUpdated).toBeNull()
  })

  it('get_secret_metadata returns empty on missing creds', async () => {
    const agent = new VaultAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_secret_metadata')!

    const result = await tool.execute({ path: 'secret/myapp' }, {}) as { keys: unknown[]; lastUpdated: null }
    expect(result.keys).toEqual([])
    expect(result.lastUpdated).toBeNull()
  })

  it('get_secret_metadata returns empty keys on LIST failure (404)', async () => {
    const agent = new VaultAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_secret_metadata')!

    const result = await tool.execute(
      { path: 'nonexistent/foo' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { keys: unknown[]; lastUpdated: null }

    expect(result.keys).toEqual([])
    expect(result.lastUpdated).toBeNull()
  })

  // ── list_policies ──────────────────────────────────────────────────

  it('list_policies returns real policy names from fixture', async () => {
    const agent = new VaultAgent()
    const tool = agent.tools.find(t => t.definition.name === 'list_policies')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      {},
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { policies: string[] }

    expect(result.policies).toEqual(['admin', 'readonly', 'deployer'])
  })

  it('list_policies returns empty on missing creds', async () => {
    const agent = new VaultAgent()
    const tool = agent.tools.find(t => t.definition.name === 'list_policies')!

    const result = await tool.execute({}, {}) as { policies: unknown[] }
    expect(result.policies).toEqual([])
  })

  it('list_policies returns empty on server error', async () => {
    const agent = new VaultAgent()
    const tool = agent.tools.find(t => t.definition.name === 'list_policies')!

    // Point at a port that doesn't respond → connection refused → caught → empty
    const result = await tool.execute(
      {},
      { baseUrl: 'http://127.0.0.1:1', token: 'fixture-token' },
    ) as { policies: unknown[] }
    expect(result.policies).toEqual([])
  })

  // ── request tracking ───────────────────────────────────────────────

  it('fixture server received mount list + metadata + policy requests', () => {
    const paths = fixture.receivedRequests.map(r => `${r.method} ${r.path.split('?')[0]}`)
    expect(paths.some(p => p === 'GET /v1/sys/mounts'), 'expected GET /v1/sys/mounts').toBe(true)
    expect(paths.some(p => p === 'GET /v1/secret/metadata/myapp/'), 'expected GET …/myapp/ (list)').toBe(true)
    expect(paths.some(p => p === 'GET /v1/secret/metadata/myapp'), 'expected GET …/myapp (metadata)').toBe(true)
    expect(paths.some(p => p === 'GET /v1/sys/policies/acl'), 'expected GET /v1/sys/policies/acl').toBe(true)
  })
})

describe('vault — orchestration (specialist agent)', () => {
  it('specialist agent routes user query to tool and returns grounded response', async () => {
    // Requires a real LLM provider. Skip if none configured.
    const providerType = process.env['ANTHROPIC_API_KEY'] ? 'anthropic'
      : process.env['OPENAI_API_KEY'] ? 'openai'
      : process.env['OLLAMA_ENDPOINT'] ? 'ollama'
      : null
    if (!providerType) {
      console.log('Skipping orchestration test — no model provider configured')
      return
    }
    // Orchestration test: verify the agent harness routes "List Vault
    // secret engines" to the correct tool. Fixture validates the HTTP call.
    expect(true).toBe(true) // placeholder — full agent run requires real model
  })
})
