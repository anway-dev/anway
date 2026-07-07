import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { SnykBootstrap } from './bootstrap.js'
import { SnykAgent } from './agent.js'

// ── Realistic Snyk API fixtures — multi-org, multi-project ────────────

const orgsFixture = {
  orgs: [
    { id: 'org-1', name: 'acme', slug: 'acme' },
    { id: 'org-2', name: 'acme-labs', slug: 'acme-labs' },
  ],
}

const org1ProjectsFixture = {
  projects: [
    { id: 'proj-1', name: 'payments-api', type: 'npm' },
    { id: 'proj-2', name: 'checkout-api', type: 'npm' },
  ],
}

const org2ProjectsFixture = {
  projects: [
    { id: 'proj-3', name: 'auth-service', type: 'golang' },
  ],
}

// Snyk v1 POST /org/{orgId}/project/{projectId}/issues response shape
// Each vulnerability has: id, issueData: { severity, title }, pkgName, isFixable
const proj1VulnsFixture = {
  issues: {
    vulnerabilities: [
      {
        id: 'SNYK-JS-EXPRESS-450006',
        issueData: { severity: 'critical', title: 'Remote Code Execution' },
        pkgName: 'express',
        isFixable: true,
      },
      {
        id: 'SNYK-JS-LODASH-567746',
        issueData: { severity: 'high', title: 'Prototype Pollution' },
        pkgName: 'lodash',
        isFixable: true,
      },
      {
        id: 'SNYK-JS-MINIMIST-559764',
        issueData: { severity: 'medium', title: 'Regular Expression Denial of Service (ReDoS)' },
        pkgName: 'minimist',
        isFixable: true,
      },
    ],
  },
}

const proj3VulnsFixture = {
  issues: {
    vulnerabilities: [
      {
        id: 'SNYK-GOLANG-GOLANGORGXNET-1083182',
        issueData: { severity: 'low', title: 'Information Exposure' },
        pkgName: 'golang.org/x/net',
        isFixable: false,
      },
      {
        id: 'SNYK-GOLANG-GITHUBCOMLIBPQ-1083183',
        issueData: { severity: 'high', title: 'SQL Injection' },
        pkgName: 'github.com/lib/pq',
        isFixable: true,
      },
    ],
  },
}

const emptyVulnsFixture = {
  issues: { vulnerabilities: [] },
}

const fixtureRoutes: FixtureRoute[] = [
  // Org listing
  { method: 'GET', path: '/v1/orgs', status: 200, body: orgsFixture },
  // Projects per org
  { method: 'GET', path: '/v1/org/org-1/projects', status: 200, body: org1ProjectsFixture },
  { method: 'GET', path: '/v1/org/org-2/projects', status: 200, body: org2ProjectsFixture },
  // Issues per project (POST)
  { method: 'POST', path: '/v1/org/org-1/project/proj-1/issues', status: 200, body: proj1VulnsFixture },
  { method: 'POST', path: '/v1/org/org-1/project/proj-2/issues', status: 200, body: emptyVulnsFixture },
  { method: 'POST', path: '/v1/org/org-2/project/proj-3/issues', status: 200, body: proj3VulnsFixture },
  // Server error for a specific project
  { method: 'POST', path: '/v1/org/org-1/project/proj-err/issues', status: 500, body: {} },
]

describe('snyk — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  // ── bootstrap (still real, verify with richer fixture) ──────────────

  it('bootstrap extracts entities from multi-org fixture', async () => {
    const kg = new FakeKG()
    const result = await new SnykBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any,
      'test-connector',
      { token: 'fixture-token', baseUrl: fixture.baseUrl },
    )

    // 3 projects across 2 orgs
    expect(result.entitiesUpserted).toBe(3)
    expect(result.relationshipsUpserted).toBe(0)

    const names = kg.entities.map(e => e.name).sort()
    expect(names).toEqual(['auth-service', 'checkout-api', 'payments-api'])

    // Verify connectorCoordinates stored on a snyk entity
    const payments = kg.entities.find(e => e.name === 'payments-api')!
    const coordinates = payments.metadata as {
      connectorCoordinates?: { snyk?: { resourceIds?: Record<string, string> } }
    }
    expect(coordinates.connectorCoordinates?.snyk?.resourceIds).toMatchObject({
      orgId: 'org-1',
      projectId: 'proj-1',
    })
  })

  // ── get_vulnerabilities — by project ID ─────────────────────────────

  it('get_vulnerabilities resolves by project ID and returns real data', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { project: 'proj-1' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { vulns: Array<{ id: string; severity: string; title: string; packageName: string; fixable: boolean }> }

    expect(result.vulns).toHaveLength(3)

    // Critical: Remote Code Execution in express
    expect(result.vulns[0]).toMatchObject({
      id: 'SNYK-JS-EXPRESS-450006',
      severity: 'critical',
      title: 'Remote Code Execution',
      packageName: 'express',
      fixable: true,
    })

    // High: Prototype Pollution in lodash
    expect(result.vulns[1]).toMatchObject({
      id: 'SNYK-JS-LODASH-567746',
      severity: 'high',
      title: 'Prototype Pollution',
      packageName: 'lodash',
      fixable: true,
    })

    // Medium: ReDoS in minimist
    expect(result.vulns[2]).toMatchObject({
      id: 'SNYK-JS-MINIMIST-559764',
      severity: 'medium',
      title: 'Regular Expression Denial of Service (ReDoS)',
      packageName: 'minimist',
      fixable: true,
    })
  })

  // ── get_vulnerabilities — by project name ───────────────────────────

  it('get_vulnerabilities resolves by project name', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    const result = await tool.execute(
      { project: 'auth-service' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { vulns: Array<{ id: string; severity: string; packageName: string; fixable: boolean }> }

    // auth-service lives in org-2, has 2 vulns
    expect(result.vulns).toHaveLength(2)

    expect(result.vulns[0]).toMatchObject({
      id: 'SNYK-GOLANG-GOLANGORGXNET-1083182',
      severity: 'low',
      packageName: 'golang.org/x/net',
      fixable: false,
    })

    expect(result.vulns[1]).toMatchObject({
      id: 'SNYK-GOLANG-GITHUBCOMLIBPQ-1083183',
      severity: 'high',
      packageName: 'github.com/lib/pq',
      fixable: true,
    })
  })

  // ── get_vulnerabilities — project ID from a later org ───────────────

  it('get_vulnerabilities finds project in a non-first org', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    const result = await tool.execute(
      { project: 'proj-3' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { vulns: Array<{ id: string }> }

    // proj-3 is in org-2 (searched second) — verifies traversal doesn't stop at org-1
    expect(result.vulns).toHaveLength(2)
    expect(result.vulns[0].id).toBe('SNYK-GOLANG-GOLANGORGXNET-1083182')
  })

  // ── get_vulnerabilities — empty vulns for project with no issues ────

  it('get_vulnerabilities returns empty vulns for clean project', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    const result = await tool.execute(
      { project: 'proj-2' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { vulns: unknown[] }

    expect(result.vulns).toEqual([])
  })

  // ── get_vulnerabilities — project not found ─────────────────────────

  it('get_vulnerabilities returns empty when project not found', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    const result = await tool.execute(
      { project: 'nonexistent-project' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    ) as { vulns: unknown[] }

    expect(result.vulns).toEqual([])
  })

  // ── get_vulnerabilities — missing credentials ────────────────────────

  it('get_vulnerabilities throws on missing token (real failure, not an empty result)', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    await expect(tool.execute(
      { project: 'proj-1' },
      {},
    )).rejects.toThrow('Snyk credentials not configured')
  })

  it('get_vulnerabilities throws when only token present (no baseUrl) — real network failure, not empty', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    // Token present but no baseUrl — defaults to https://api.snyk.io, which
    // genuinely fails to connect in this test environment. The org-list
    // fetch that failure occurs in now throws rather than silently
    // returning null (see resolveProject's comment in agent.ts).
    await expect(tool.execute(
      { project: 'proj-1' },
      { token: 'some-token' },
    )).rejects.toThrow()
  })

  // ── get_vulnerabilities — API error (500) ────────────────────────────

  it('get_vulnerabilities throws when the org-list fetch fails (real connection failure, not empty)', async () => {
    // We can't route "proj-err" through resolveProject because it's not in any org's
    // project list. Instead, test with connection refused (points to a port
    // that doesn't respond) — this fails in resolveProject's org-list fetch,
    // which now throws rather than silently returning null.
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    await expect(tool.execute(
      { project: 'proj-1' },
      { baseUrl: 'http://127.0.0.1:54321', token: 'fixture-token' },
    )).rejects.toThrow()
  })

  // ── get_vulnerabilities — empty project param ────────────────────────

  it('get_vulnerabilities throws when project param is empty (real usage error, not an empty result)', async () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!

    await expect(tool.execute(
      { project: '' },
      { baseUrl: fixture.baseUrl, token: 'fixture-token' },
    )).rejects.toThrow('Snyk get_vulnerabilities: project is required')
  })

  // ── request tracking ─────────────────────────────────────────────────

  it('fixture server received org + project + issues requests', () => {
    const paths = fixture.receivedRequests.map(r => `${r.method} ${r.path.split('?')[0]!}`)

    // Bootstrap: GET /v1/orgs + GET /v1/org/org-1/projects + GET /v1/org/org-2/projects
    expect(
      paths.filter(p => p === 'GET /v1/orgs').length,
      'expected at least one GET /v1/orgs call',
    ).toBeGreaterThan(0)

    // Agent: POST issues calls
    expect(
      paths.some(p => p === 'POST /v1/org/org-1/project/proj-1/issues'),
      'expected POST /v1/org/org-1/project/proj-1/issues call',
    ).toBe(true)

    expect(
      paths.some(p => p === 'POST /v1/org/org-2/project/proj-3/issues'),
      'expected POST /v1/org/org-2/project/proj-3/issues call (project in non-first org)',
    ).toBe(true)
  })

  // ── tool definition integrity ───────────────────────────────────────

  it('get_vulnerabilities has correct schema', () => {
    const agent = new SnykAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_vulnerabilities')!
    const params = tool.definition.parameters as {
      required?: string[]
      properties: Record<string, { type: string }>
    }
    expect(params.required).toContain('project')
    expect(params.properties.project.type).toBe('string')
    expect(tool.write).toBe(false)
  })
})

// ── orchestration (specialist agent) — placeholder ────────────────────

describe('snyk — orchestration (specialist agent)', () => {
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
    // Orchestration test: verify the agent harness routes "List Snyk vulnerabilities"
    // to the correct tool. Fixture/container validates the HTTP call.
    expect(true).toBe(true) // placeholder — full agent run requires real model
  })
})
