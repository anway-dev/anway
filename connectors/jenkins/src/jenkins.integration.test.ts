import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { JenkinsBootstrap } from './bootstrap.js'
import { JenkinsAgent } from './agent.js'


const pipelineFixture = {
  jobs: [
    { name: 'deploy-payments', url: 'http://jenkins:8080/job/deploy-payments/', color: 'blue' },
    { name: 'build-auth', url: 'http://jenkins:8080/job/build-auth/', color: 'red' },
    { name: 'test-checkout', url: 'http://jenkins:8080/job/test-checkout/', color: 'blue_anime' },
    { name: 'disabled-legacy', url: 'http://jenkins:8080/job/disabled-legacy/', color: 'disabled' },
    { name: 'deploy-notifications', url: 'http://jenkins:8080/job/deploy-notifications/', color: 'aborted' },
  ],
}

const buildFixture = {
  builds: [
    { number: 42, result: 'SUCCESS', timestamp: 1710000000000, duration: 120000 },
    { number: 41, result: 'FAILURE', timestamp: 1709900000000, duration: 85000 },
    { number: 40, result: 'UNSTABLE', timestamp: 1709800000000, duration: 90000 },
    { number: 39, result: null, timestamp: 1709700000000, duration: 0 },
  ],
}

const fixtureRoutes: FixtureRoute[] = [
  {
    method: 'GET',
    path: '/api/json',
    status: 200,
    body: pipelineFixture,
  },
  {
    method: 'GET',
    path: '/job/deploy-payments/api/json',
    status: 200,
    body: buildFixture,
  },
  {
    method: 'GET',
    path: '/job/nonexistent/api/json',
    status: 404,
    body: {},
  },
]

describe('jenkins — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new JenkinsBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector',
      { baseUrl: fixture.baseUrl, user: 'admin', apiToken: 'test-token' },
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(result.episodeHints.length).toBeGreaterThan(0)
  })

  it('get_pipelines returns real parsed data from fixture', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      {},
      { baseUrl: fixture.baseUrl, user: 'admin', apiToken: 'test-token' },
    ) as { pipelines: Array<{ id: string; name: string; status: string; url: string }> }

    expect(result.pipelines).toHaveLength(5)
    expect(result.pipelines[0]).toEqual({
      id: 'deploy-payments', name: 'deploy-payments', status: 'passed',
      url: 'http://jenkins:8080/job/deploy-payments/',
    })
    expect(result.pipelines[1].status).toBe('failed')   // red
    expect(result.pipelines[3].status).toBe('disabled')  // disabled
    expect(result.pipelines[4].status).toBe('aborted')   // aborted
  })

  it('get_pipelines filters by service param', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    const result = await tool.execute(
      { service: 'payments' },
      { baseUrl: fixture.baseUrl, user: 'admin', apiToken: 'test-token' },
    ) as { pipelines: Array<{ id: string }> }

    expect(result.pipelines).toHaveLength(1)
    expect(result.pipelines[0].id).toBe('deploy-payments')
  })

  it('get_pipelines with no service param returns all', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    const result = await tool.execute(
      { service: undefined },
      { baseUrl: fixture.baseUrl, user: 'admin', apiToken: 'test-token' },
    ) as { pipelines: Array<{ id: string }> }

    expect(result.pipelines).toHaveLength(5)
  })

  it('get_pipelines throws on missing creds (real failure, not an empty result)', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_pipelines')!

    await expect(tool.execute({}, {})).rejects.toThrow('Jenkins credentials not configured')
  })

  it('get_builds returns real parsed data from fixture', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!
    expect(tool).toBeDefined()
    expect(tool.write).toBe(false)

    const result = await tool.execute(
      { pipeline: 'deploy-payments' },
      { baseUrl: fixture.baseUrl, user: 'admin', apiToken: 'test-token' },
    ) as { builds: Array<{ id: string; number: number; status: string; duration: number; startedAt: string; sha: string }> }

    expect(result.builds).toHaveLength(4)
    expect(result.builds[0].id).toBe('b-42')
    expect(result.builds[0].number).toBe(42)
    expect(result.builds[0].status).toBe('success')
    expect(result.builds[0].duration).toBe(120000)
    expect(result.builds[0].startedAt).toBeDefined()
    expect(result.builds[1].status).toBe('failed')     // FAILURE
    expect(result.builds[2].status).toBe('unstable')   // UNSTABLE
    expect(result.builds[3].status).toBe('running')    // null result
    expect(result.builds[3].sha).toBe('')              // not exposed by Jenkins REST API
  })

  it('get_builds limit param encoded in URL', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!

    await tool.execute(
      { pipeline: 'deploy-payments', limit: 2 },
      { baseUrl: fixture.baseUrl, user: 'admin', apiToken: 'test-token' },
    )

    // Verify the URL includes the tree range from the limit param
    const buildPaths = fixture.receivedRequests
      .filter(r => r.path.includes('/job/'))
      .map(r => r.path)
    const limitedPath = buildPaths.find(p => p.includes('{0,1}'))
    expect(limitedPath, 'expected tree range {0,1} for limit=2').toBeDefined()
  })

  it('get_builds throws for nonexistent job (404 is a real failure, not empty)', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!

    await expect(tool.execute(
      { pipeline: 'nonexistent' },
      { baseUrl: fixture.baseUrl, user: 'admin', apiToken: 'test-token' },
    )).rejects.toThrow('Jenkins API failed: HTTP 404')
  })

  it('get_builds throws on missing creds (real failure, not an empty result)', async () => {
    const agent = new JenkinsAgent()
    const tool = agent.tools.find(t => t.definition.name === 'get_builds')!

    await expect(tool.execute({ pipeline: 'test' }, {})).rejects.toThrow('Jenkins credentials not configured')
  })

  it('fixture server received pipeline + build requests', () => {
    const paths = fixture.receivedRequests.map(r => r.path.split('?')[0]!)
    expect(paths.some(p => p === '/api/json'), 'expected /api/json call').toBe(true)
    expect(paths.some(p => p.includes('/job/deploy-payments/api/json')), 'expected /job/* call').toBe(true)
  })
})
