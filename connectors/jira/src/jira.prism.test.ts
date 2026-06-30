import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import { JiraBootstrap } from './bootstrap.js'
import { JiraAgent } from './agent.js'
import path from 'node:path'

describe('jira — Prism contract test', () => {
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
      .withWaitStrategy(Wait.forLogMessage('Prism is listening'))
      .start()
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(4010)}`
  }, 60_000)

  afterAll(async () => { await container?.stop() })

  it('bootstrap requests match official API spec', async () => {
    const kg = new FakeKG()
    const result = await new JiraBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'prism-test',
      { host: baseUrl, email: 'test@test.com', token: 'prism-test-token' }
    )
    // Prism returns spec examples — bootstrap must parse them without throwing
    expect(result.episodeHints.length).toBeGreaterThan(0)
  })
})
