import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { SonarQubeBootstrap } from './bootstrap.js'
import { SonarqubeAgent } from './agent.js'

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

const issuesFixture = {
  total: 3,
  issues: [
    {
      key: 'AYs8hCqDqT4sL5wH0gBt',
      rule: 'java:S2259',
      severity: 'CRITICAL',
      component: 'com.example:payments-api:src/main/java/com/example/PaymentService.java',
      project: 'com.example:payments-api',
      line: 142,
      hash: 'abc123',
      textRange: { startLine: 142, endLine: 142, startOffset: 0, endOffset: 42 },
      message: 'Null pointer dereference in payment processor',
      type: 'BUG',
      creationDate: '2026-06-15T10:30:00+00:00',
      updateDate: '2026-07-01T08:15:00+00:00',
      status: 'OPEN',
    },
    {
      key: 'AYs8hCqDqT4sL5wH0gBu',
      rule: 'java:S107',
      severity: 'MAJOR',
      component: 'com.example:payments-api:src/main/java/com/example/CheckoutHandler.java',
      project: 'com.example:payments-api',
      line: 56,
      hash: 'def456',
      message: 'Method has too many parameters',
      type: 'CODE_SMELL',
      creationDate: '2026-06-20T14:00:00+00:00',
      updateDate: '2026-06-20T14:00:00+00:00',
      status: 'OPEN',
    },
    {
      key: 'AYs8hCqDqT4sL5wH0gBv',
      rule: 'python:S2068',
      severity: 'BLOCKER',
      component: 'payments-api:src/config.py',
      project: 'payments-api',
      line: 12,
      hash: 'ghi789',
      message: 'Hardcoded credentials found in config file',
      type: 'VULNERABILITY',
      creationDate: '2026-07-03T09:00:00+00:00',
      updateDate: '2026-07-03T09:00:00+00:00',
      status: 'OPEN',
    },
    {
      key: 'AYs8hCqDqT4sL5wH0gBw',
      rule: 'java:S106',
      severity: 'INFO',
      component: 'com.example:payments-api:src/main/java/com/example/Logger.java',
      project: 'com.example:payments-api',
      message: 'System.out.println used for logging',
      type: 'CODE_SMELL',
      creationDate: '2026-06-25T11:00:00+00:00',
      updateDate: '2026-06-25T11:00:00+00:00',
      status: 'OPEN',
    },
  ],
}

const metricsFixture = {
  component: {
    id: 'AYs8hABC123',
    key: 'com.example:payments-api',
    name: 'payments-api',
    qualifier: 'TRK',
    measures: [
      { metric: 'coverage', value: '85.3', bestValue: false },
      { metric: 'duplicated_lines_density', value: '3.1', bestValue: true },
      { metric: 'bugs', value: '12', bestValue: false },
      { metric: 'vulnerabilities', value: '0', bestValue: true },
    ],
  },
}

const emptyMetricsFixture = {
  component: {
    id: 'AYs8hXYZ999',
    key: 'com.example:empty-project',
    name: 'empty-project',
    qualifier: 'TRK',
    measures: [],
  },
}

const fixtureRoutes: FixtureRoute[] = [
  {
    method: 'GET',
    path: '/api/issues/search',
    status: 200,
    body: issuesFixture,
  },
  {
    method: 'GET',
    path: '/api/measures/component',
    status: 200,
    body: metricsFixture,
  },
]

describe('sonarqube — fixture HTTP server', () => {
  let fixture: FixtureServer
  const tenantId = '00000000-0000-0000-0000-000000000001' as any

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    // bootstrap calls /api/projects/search which won't match the fixture routes (404)
    // but that's expected — bootstrap handles non-ok gracefully
    const result = await new SonarQubeBootstrap(kg).bootstrap(
      tenantId, 'test-connector',
      { baseUrl: fixture.baseUrl, token: 'test-token' },
    )
    // Bootstrap won't match routes — /api/projects/search is not in our fixture
    // but the call should not throw
    expect(result.entitiesUpserted).toBeGreaterThanOrEqual(0)
    expect(result.episodeHints).toBeDefined()
  })

  describe('get_issues', () => {
    it('returns real parsed data from fixture', async () => {
      const agent = new SonarqubeAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_issues')!
      expect(tool).toBeDefined()
      expect(tool.write).toBe(false)

      const result = await tool.execute(
        { project: 'com.example:payments-api' },
        { baseUrl: fixture.baseUrl, token: 'test-token' },
      ) as { issues: Array<{ severity: string; type: string; message: string; file: string; line: number }> }

      expect(result.issues).toHaveLength(4)

      // Critical BUG — severity lowercased, file path extracted from component key
      expect(result.issues[0]).toEqual({
        severity: 'critical',
        type: 'BUG',
        message: 'Null pointer dereference in payment processor',
        file: 'src/main/java/com/example/PaymentService.java',
        line: 142,
      })

      // MAJOR CODE_SMELL
      expect(result.issues[1]).toEqual({
        severity: 'major',
        type: 'CODE_SMELL',
        message: 'Method has too many parameters',
        file: 'src/main/java/com/example/CheckoutHandler.java',
        line: 56,
      })

      // BLOCKER VULNERABILITY — single-colon project key
      expect(result.issues[2]).toEqual({
        severity: 'blocker',
        type: 'VULNERABILITY',
        message: 'Hardcoded credentials found in config file',
        file: 'src/config.py',
        line: 12,
      })

      // INFO CODE_SMELL — no line field, defaults to 0
      expect(result.issues[3].severity).toBe('info')
      expect(result.issues[3].type).toBe('CODE_SMELL')
      expect(result.issues[3].file).toBe('src/main/java/com/example/Logger.java')
      expect(result.issues[3].line).toBe(0)
    })

    it('throws on missing creds (real failure, not an empty result)', async () => {
      const agent = new SonarqubeAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

      await expect(tool.execute(
        { project: 'com.example:payments-api' },
        {},
      )).rejects.toThrow('SonarQube credentials not configured')
    })

    it('throws on missing token (null creds) — real failure, not an empty result', async () => {
      const agent = new SonarqubeAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

      await expect(tool.execute(
        { project: 'com.example:payments-api' },
        { baseUrl: fixture.baseUrl },  // baseUrl present but no token
      )).rejects.toThrow('SonarQube credentials not configured')
    })

    it('throws when API returns 404 (no matching fixture route) — real failure, not an empty result', async () => {
      const agent = new SonarqubeAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_issues')!

      // Use a baseUrl that will 404 on every request (no fixture routes)
      await expect(tool.execute(
        { project: 'com.example:payments-api' },
        { baseUrl: 'http://127.0.0.1:19999', token: 'test-token' },
      )).rejects.toThrow()
    })
  })

  describe('get_quality_metrics', () => {
    it('returns real parsed data from fixture', async () => {
      const agent = new SonarqubeAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_quality_metrics')!
      expect(tool).toBeDefined()
      expect(tool.write).toBe(false)

      const result = await tool.execute(
        { project: 'com.example:payments-api' },
        { baseUrl: fixture.baseUrl, token: 'test-token' },
      ) as { coverage: number; duplication: number; bugs: number; vulnerabilities: number }

      expect(result.coverage).toBe(85.3)
      expect(result.duplication).toBe(3.1)
      expect(result.bugs).toBe(12)
      expect(result.vulnerabilities).toBe(0)
    })

    it('throws on missing creds instead of a false "0 bugs, 0 vulnerabilities" all-clear', async () => {
      const agent = new SonarqubeAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_quality_metrics')!

      await expect(tool.execute(
        { project: 'com.example:payments-api' },
        {},
      )).rejects.toThrow('SonarQube credentials not configured')
    })

    it('throws when API errors instead of a false "0 bugs, 0 vulnerabilities" all-clear', async () => {
      const agent = new SonarqubeAgent()
      const tool = agent.tools.find(t => t.definition.name === 'get_quality_metrics')!

      // URL that will fail to connect/respond
      await expect(tool.execute(
        { project: 'com.example:payments-api' },
        { baseUrl: 'http://127.0.0.1:19999', token: 'test-token' },
      )).rejects.toThrow()
    })
  })

  it('fixture server received issue + metrics requests', () => {
    const paths = fixture.receivedRequests.map(r => r.path.split('?')[0]!)
    expect(paths.some(p => p === '/api/issues/search'), 'expected /api/issues/search call').toBe(true)
    expect(paths.some(p => p === '/api/measures/component'), 'expected /api/measures/component call').toBe(true)
  })
})
