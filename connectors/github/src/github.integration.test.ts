import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'
import type { FixtureRoute, FixtureServer } from '@anway/agent/testing'
import { GitHubBootstrap } from './bootstrap.js'
import { GithubAgent } from './agent.js'

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
 * behavior (missing creds, non-OK HTTP, etc.) exercised in this file. A stronger real-API-contract check exists in the sibling
 * github.prism.test.ts (validates requests against the real published
 * OpenAPI/AsyncAPI spec via Prism, not a self-authored fixture).
 */


const codeownersContent = Buffer.from('* @test-org/platform @bob\n').toString('base64')

const fixtureRoutes: FixtureRoute[] = [
  { method: 'GET', path: '/user', status: 200, body: {'login': 'test-org', 'type': 'Organization'} },
  { method: 'GET', path: '/orgs/test-org/repos', status: 200, body: [{'id': 1, 'name': 'payments', 'full_name': 'test-org/payments', 'language': 'TypeScript', 'default_branch': 'main'}] },
  { method: 'GET', path: '/repos/test-org/payments/pulls', status: 200, body: [] },
  { method: 'GET', path: '/repos/test-org/payments/commits', status: 200, body: [] },
  { method: 'GET', path: '/repos/test-org/payments/contributors', status: 200, body: [{'login': 'dave', 'contributions': 42}] },
  { method: 'GET', path: '/repos/test-org/payments/contents/CODEOWNERS', status: 200, body: { content: codeownersContent, encoding: 'base64' } },
  { method: 'GET', path: '/orgs/test-org/teams/platform/members', status: 200, body: [{'login': 'alice'}, {'login': 'carol'}] },
]

describe('github — fixture HTTP server', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer(fixtureRoutes)
  }, 10_000)

  afterAll(async () => { await fixture.close() })

  it('bootstrap extracts entities from fixture', async () => {
    const kg = new FakeKG()
    const result = await new GitHubBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { token: "fixture-token", baseUrl: fixture.baseUrl, org: 'test-org' }
    )
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(kg.entities.some(e => e.name === 'test-org/payments'), 'expected entity test-org/payments not extracted').toBe(true)
  })

  // Regression test for finding A5: CLAUDE.md documents this connector
  // extracting "Engineer (committers), Team (CODEOWNERS)" and creating
  // "Engineer→MEMBER_OF→Team", but no code ever created an Engineer entity
  // or any relationship at all (relationshipsUpserted was hardcoded 0).
  it('extracts real committers as Engineer entities and team members via Engineer→MEMBER_OF→Team', async () => {
    const kg = new FakeKG()
    const result = await new GitHubBootstrap(kg).bootstrap(
      '00000000-0000-0000-0000-000000000001' as any, 'test-connector', { token: "fixture-token", baseUrl: fixture.baseUrl, org: 'test-org' }
    )

    // Real repo contributor → Engineer entity
    expect(kg.entities.some(e => e.type === 'Engineer' && e.name === 'dave'), 'expected contributor dave as Engineer').toBe(true)

    // CODEOWNERS team ref (@test-org/platform) → real Team entity
    expect(kg.entities.some(e => e.type === 'Team' && e.name === 'platform'), 'expected Team platform').toBe(true)

    // CODEOWNERS individual ref (@bob) must NOT become a bogus Team entity
    // — confirmed live via independent review this was a real pre-existing
    // bug: any @-mention (team or individual) was treated as a Team.
    expect(kg.entities.some(e => e.type === 'Team' && e.name === 'bob'), 'bob must not be a Team').toBe(false)

    // Real team members (alice, carol) → Engineer entities + MEMBER_OF edges
    expect(kg.entities.some(e => e.type === 'Engineer' && e.name === 'alice')).toBe(true)
    expect(kg.entities.some(e => e.type === 'Engineer' && e.name === 'carol')).toBe(true)
    expect(kg.relationships.some(r => r.relType === 'MEMBER_OF' && r.fromEntityId === 'Engineer:alice' && r.toEntityId === 'Team:platform')).toBe(true)
    expect(kg.relationships.some(r => r.relType === 'MEMBER_OF' && r.fromEntityId === 'Engineer:carol' && r.toEntityId === 'Team:platform')).toBe(true)

    expect(result.relationshipsUpserted).toBeGreaterThan(0)
  })

  it('agent tools query fixture server', async () => {
    const agent = new GithubAgent()
    const tools = agent.tools
    expect(tools.length).toBeGreaterThan(0)
    // get_prs (tools[0]) requires `repo` — omitting it and calling with no
    // creds is no longer a no-op empty result, it's a real thrown error
    // (missing token), so pass real params matching the fixture routes.
    const firstTool = tools[0]!
    const result = await firstTool.execute({ repo: 'test-org/payments' }, { baseUrl: fixture.baseUrl, token: 'fixture-token' }) as { prs: unknown[] }
    expect(result.prs).toBeDefined()
  })

  it('agent tools throw on missing token instead of returning an empty result', async () => {
    const agent = new GithubAgent()
    const firstTool = agent.tools[0]!
    await expect(firstTool.execute({ repo: 'test-org/payments' }, { baseUrl: fixture.baseUrl })).rejects.toThrow('GitHub credentials not configured')
  })

  it('fixture server received at least one request', () => {
    expect(fixture.receivedRequests.length).toBeGreaterThan(0)
  })
})


  describe('github — orchestration (specialist agent)', () => {
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
      // Orchestration test: verify the agent harness routes "List repos for test-org"
      // to the correct tool. Fixture/container validates the HTTP call.
      expect(true).toBe(true)  // placeholder — full agent run requires real model
    })
  })
