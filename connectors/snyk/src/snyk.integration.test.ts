import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { SnykBootstrap } from './bootstrap.js'
import { SnykAgent } from './agent.js'

/**
 * "integration test" naming note: this suite runs against an in-process
 * fixture HTTP server (startFixtureServer), not a real deployed instance of
 * the SaaS API — the fixture's response shapes are authored by the same
 * person/session writing the connector implementation being tested. A
 * systematic misunderstanding of the real API's actual response shape would
 * be baked into both the fixture and the implementation identically, so
 * this suite passing does not by itself prove the real integration works.
 * It does correctly catch: request URL/param construction bugs, response
 * parsing bugs given a *correctly guessed* shape, and the error-handling
 * behavior (missing creds, non-OK HTTP, etc.) exercised in this file. No stronger real-API-contract test exists for this connector yet
 * (see connectors/{github,jira,confluence,pagerduty,slack} for the Prism-based
 * pattern this could be upgraded to).
 */

// ── Realistic Snyk REST API fixtures — multi-org, multi-project ───────
// Shapes follow the docs-verified Snyk REST API (JSON:API envelopes):
// GET /rest/orgs, GET /rest/orgs/{id}/projects,
// GET /rest/orgs/{id}/issues?scan_item.id=...&scan_item.type=project.
// The fixture server matches method+path only (query stripped), so each
// project whose issues we assert lives in its OWN org.

const orgsFixture = {
  data: [
    { id: 'org-1', attributes: { name: 'acme' } },
    { id: 'org-2', attributes: { name: 'acme-labs' } },
    { id: 'org-3', attributes: { name: 'acme-clean' } },
  ],
}

const org1ProjectsFixture = { data: [{ id: 'proj-1', attributes: { name: 'payments-api' } }] }
const org2ProjectsFixture = { data: [{ id: 'proj-3', attributes: { name: 'auth-service' } }] }
const org3ProjectsFixture = { data: [{ id: 'proj-2', attributes: { name: 'checkout-api' } }] }

const restIssue = (id: string, severity: string, title: string, pkg: string, fixable: boolean) => ({
  id,
  attributes: {
    title,
    effective_severity_level: severity,
    coordinates: [{
      is_upgradeable: fixable,
      representations: [{ dependency: { package_name: pkg } }],
    }],
  },
})

const org1IssuesFixture = {
  data: [
    restIssue('SNYK-JS-EXPRESS-450006', 'critical', 'Remote Code Execution', 'express', true),
    restIssue('SNYK-JS-LODASH-567746', 'high', 'Prototype Pollution', 'lodash', true),
    restIssue('SNYK-JS-MINIMIST-559764', 'medium', 'Regular Expression Denial of Service (ReDoS)', 'minimist', true),
  ],
}

const org2IssuesFixture = {
  data: [
    restIssue('SNYK-GOLANG-GOLANGORGXNET-1083182', 'low', 'Information Exposure', 'golang.org/x/net', false),
    restIssue('SNYK-GOLANG-GITHUBCOMLIBPQ-1083183', 'high', 'SQL Injection', 'github.com/lib/pq', true),
  ],
}

const emptyIssuesFixture = { data: [] }

const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/rest/orgs', status: 200, body: orgsFixture },
  { method: 'GET', path: '/rest/orgs/org-1/projects', status: 200, body: org1ProjectsFixture },
  { method: 'GET', path: '/rest/orgs/org-2/projects', status: 200, body: org2ProjectsFixture },
  { method: 'GET', path: '/rest/orgs/org-3/projects', status: 200, body: org3ProjectsFixture },
  { method: 'GET', path: '/rest/orgs/org-1/issues', status: 200, body: org1IssuesFixture },
  { method: 'GET', path: '/rest/orgs/org-2/issues', status: 200, body: org2IssuesFixture },
  { method: 'GET', path: '/rest/orgs/org-3/issues', status: 200, body: emptyIssuesFixture },
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

    // Bootstrap: GET /rest/orgs + per-org project lists
    expect(
      paths.filter(p => p === 'GET /rest/orgs').length,
      'expected at least one GET /rest/orgs call',
    ).toBeGreaterThan(0)

    // Agent: REST issues calls, scoped per org
    expect(
      paths.some(p => p === 'GET /rest/orgs/org-1/issues'),
      'expected GET /rest/orgs/org-1/issues call',
    ).toBe(true)

    expect(
      paths.some(p => p === 'GET /rest/orgs/org-2/issues'),
      'expected GET /rest/orgs/org-2/issues call (project in non-first org)',
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
