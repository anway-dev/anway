import { vi, beforeEach, afterEach } from 'vitest'
import { describeConnectorConformance } from '@anway/agent/testing'
import type { IKnowledgeGraph } from '@anway/agent'
import { ConfluenceBootstrap } from './bootstrap.js'

const MOCK_HOST = 'http://mock-confluence.local'
const MOCK_TOKEN = 'test-atlassian-token'
const MOCK_EMAIL = 'admin@acme.dev'

function mockResponse(url: string, init?: RequestInit): Response {
  const u = String(url)
  if (!u.startsWith(MOCK_HOST)) throw new Error(`ECONNREFUSED ${u}`)
  const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? ''
  if (!auth.startsWith('Basic ')) return new Response('{}', { status: 401 })
  if (u.includes('/rest/api/space') && !u.includes('/content')) {
    return new Response(JSON.stringify({
      results: [{ key: 'ENG', name: 'Engineering' }],
    }), { status: 200 })
  }
  if (u.includes('/content')) {
    return new Response(JSON.stringify({
      results: [
        { id: 'page-1', title: 'On-Call Runbook', _links: { webui: '/wiki/spaces/ENG/pages/1' } },
        { id: 'page-2', title: 'Architecture Overview', _links: { webui: '/wiki/spaces/ENG/pages/2' } },
      ],
    }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}

describeConnectorConformance('confluence', {
  makeBootstrap: (kg: IKnowledgeGraph) => new ConfluenceBootstrap(kg, MOCK_HOST, MOCK_TOKEN, MOCK_EMAIL),
  validPayload: { baseUrl: MOCK_HOST, apiToken: MOCK_TOKEN, email: MOCK_EMAIL },
  unreachablePayload: { baseUrl: 'http://unreachable.invalid', apiToken: MOCK_TOKEN, email: MOCK_EMAIL },
  setupMock: () => {
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => mockResponse(String(url), init)) as typeof fetch
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})

beforeEach(() => {})
afterEach(() => {})
