import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { GenericContainer, Wait } from 'testcontainers'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent'
import { VaultBootstrap } from './bootstrap.js'
import { VaultAgent } from './agent.js'


describe('vault — integration (real Docker)', () => {
  let baseUrl: string
  let container: Awaited<ReturnType<GenericContainer['start']>>

  beforeAll(async () => {
    container = await new GenericContainer('hashicorp/vault:1.17')
      .withExposedPorts(8200)
      .withWaitStrategy(Wait.forHttp("/v1/sys/health", 8200))
      .withEnvironment({ "VAULT_DEV_ROOT_TOKEN_ID": "dev-root-token", "VAULT_DEV_LISTEN_ADDRESS": "0.0.0.0:8200" }).withCommand(["server", "-dev"])
      .start()
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(8200)}`
  }, 90_000)

  afterAll(async () => { await container?.stop() })

  it('bootstrap runs without throwing', async () => {
    const kg = new FakeKG()
    const result = await new VaultBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { "baseUrl": baseUrl, "token": "dev-root-token" }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(result.episodeHints).toBeDefined()
  })

  it('agent tools are callable against real service', async () => {
    const agent = new VaultAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
    const firstTool = tools[0]!
    const result = await firstTool.execute({}, { baseUrl, token: 'dev-root-token' })
    expect(result).toBeDefined()
  })
})
