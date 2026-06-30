import { vi, beforeEach, afterEach } from 'vitest'
import { describeConnectorConformance } from '@anway/agent/testing'
import type { IKnowledgeGraph } from '@anway/agent'
import { NewRelicBootstrap } from './bootstrap.js'

const MOCK_HOST = 'http://mock-newrelic.local'
const MOCK_KEY = 'NRAK-test-123'

function mockResponse(url: string, _init?: RequestInit): Response {
  const u = String(url)
  if (!u.startsWith(MOCK_HOST)) throw new Error(`ECONNREFUSED ${u}`)
  if (u.includes('/v2/applications.json')) {
    return new Response(JSON.stringify({
      applications: [
        { id: 1, name: 'payments-api', health_status: 'green', summary: { apdex_score: 0.98 } },
        { id: 2, name: 'auth-service', health_status: 'yellow', summary: { apdex_score: 0.91 } },
      ],
    }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}

describeConnectorConformance('newrelic', {
  makeBootstrap: (kg: IKnowledgeGraph) => new NewRelicBootstrap(kg, MOCK_KEY, MOCK_HOST),
  validPayload: { apiKey: MOCK_KEY, baseUrl: MOCK_HOST },
  unreachablePayload: { apiKey: MOCK_KEY, baseUrl: 'http://unreachable.invalid' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => mockResponse(String(url), init)))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})

beforeEach(() => {})
afterEach(() => {})
