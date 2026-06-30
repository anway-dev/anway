import { vi, beforeEach, afterEach } from 'vitest'
import { describeConnectorConformance } from '@anway/agent/testing'
import type { IKnowledgeGraph } from '@anway/agent'
import { OpsGenieBootstrap } from './bootstrap.js'

const MOCK_HOST = 'http://mock-opsgenie.local'
const MOCK_KEY = 'geniekey-test-123'

function mockResponse(url: string, _init?: RequestInit): Response {
  const u = String(url)
  if (!u.startsWith(MOCK_HOST)) throw new Error(`ECONNREFUSED ${u}`)
  if (u.includes('/v2/teams')) {
    return new Response(JSON.stringify({ data: [{ id: 'team-1', name: 'SRE' }] }), { status: 200 })
  }
  if (u.includes('/v2/schedules')) {
    return new Response(JSON.stringify({ data: [{ id: 'sched-1', name: 'Primary', ownerTeam: { id: 'team-1', name: 'SRE' } }] }), { status: 200 })
  }
  if (u.includes('/on-calls')) {
    return new Response(JSON.stringify({ data: [{ onCallRecipients: ['alice@acme.dev'] }] }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}

describeConnectorConformance('opsgenie', {
  makeBootstrap: (kg: IKnowledgeGraph) => new OpsGenieBootstrap(kg, MOCK_KEY, MOCK_HOST),
  validPayload: { apiKey: MOCK_KEY, baseUrl: MOCK_HOST },
  unreachablePayload: { apiKey: MOCK_KEY, baseUrl: 'http://unreachable.invalid' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => mockResponse(String(url), init)))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})

beforeEach(() => {})
afterEach(() => {})
