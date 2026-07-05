import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import { GitHubBootstrap } from './bootstrap.js'
import { GithubAgent } from './agent.js'
import path from 'node:path'

describe('github — Prism contract test', () => {
  let baseUrl: string
  let container: Awaited<ReturnType<GenericContainer['start']>>

  beforeAll(async () => {
    container = await new GenericContainer('stoplight/prism:4')
      .withCommand(['mock', '-h', '0.0.0.0', '/spec/openapi.yaml', '--errors'])
      .withCopyFilesToContainer([{
        source: path.resolve(__dirname, '../vendor-spec/openapi.yaml'),
        target: '/spec/openapi.yaml',
      }])
      .withExposedPorts(4010)
      .withWaitStrategy(Wait.forLogMessage('Prism is listening').withStartupTimeout(120_000))
      .start()
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(4010)}`
  }, 150_000)

  afterAll(async () => { await container?.stop() })

  it('bootstrap requests match official API spec', async () => {
    const kg = new FakeKG()
    const result = await new GitHubBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'prism-test',
      { baseUrl, token: 'prism-test-token', org: 'test-org' }
    )
    // Prism returns spec examples — bootstrap must parse them without throwing
    expect(result.episodeHints.length).toBeGreaterThan(0)
  })
})
