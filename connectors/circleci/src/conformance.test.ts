import { vi, beforeEach, afterEach } from 'vitest'
import { describeConnectorConformance } from '@anvay/agent/testing'
import type { IKnowledgeGraph } from '@anvay/agent'
import { CircleCIBootstrap } from './bootstrap.js'

const MOCK_HOST = 'http://mock-circleci.local'
const MOCK_TOKEN = 'test-circle-token-123'

function mockResponse(url: string, _init?: RequestInit): Response {
  const u = String(url)
  if (!u.startsWith(MOCK_HOST)) throw new Error(`ECONNREFUSED ${u}`)
  if (u.includes('/pipeline')) {
    return new Response(JSON.stringify({
      items: [
        { id: 'pipe-uuid-001', state: 'success', vcs: { branch: 'main', commit: { subject: 'fix payments' } } },
      ],
    }), { status: 200 })
  }
  if (u.includes('/project')) {
    return new Response(JSON.stringify([
      { slug: 'gh/anvay/payments-api', vcs_url: 'https://github.com/anvay/payments-api' },
    ]), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}

describeConnectorConformance('circleci', {
  makeBootstrap: (kg: IKnowledgeGraph) => new CircleCIBootstrap(kg, MOCK_TOKEN, MOCK_HOST),
  validPayload: { apiToken: MOCK_TOKEN, baseUrl: MOCK_HOST },
  unreachablePayload: { apiToken: MOCK_TOKEN, baseUrl: 'http://unreachable.invalid' },
  setupMock: () => {
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => mockResponse(String(url), init)) as typeof fetch
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})

beforeEach(() => {})
afterEach(() => {})
