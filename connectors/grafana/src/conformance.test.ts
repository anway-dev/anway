import { vi, beforeEach, afterEach } from 'vitest'
import { describeConnectorConformance } from '@anvay/agent/testing'
import type { IKnowledgeGraph } from '@anvay/agent'
import { GrafanaBootstrap } from './bootstrap.js'

const MOCK_HOST = 'http://mock-grafana.local:3000'
const MOCK_TOKEN = 'glsa_test-token'

function mockResponse(url: string, _init?: RequestInit): Response {
  const u = String(url)
  if (!u.startsWith(MOCK_HOST)) throw new Error(`ECONNREFUSED ${u}`)
  if (u.includes('/api/search')) {
    return new Response(JSON.stringify([{ uid: 'dash-1', title: 'Payment Dashboard' }]), { status: 200 })
  }
  if (u.includes('/api/v1/provisioning/alert-rules')) {
    return new Response(JSON.stringify([{ uid: 'alert-1', title: 'High Error Rate', labels: { service: 'payments' } }]), { status: 200 })
  }
  if (u.includes('/api/datasources')) {
    return new Response(JSON.stringify([{ uid: 'ds-1', name: 'prometheus', type: 'prometheus' }]), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}

describeConnectorConformance('grafana', {
  makeBootstrap: (kg: IKnowledgeGraph) => new GrafanaBootstrap(kg, MOCK_HOST, MOCK_TOKEN),
  validPayload: { baseUrl: MOCK_HOST, token: MOCK_TOKEN },
  unreachablePayload: { baseUrl: 'http://unreachable.invalid:3000', token: MOCK_TOKEN },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => mockResponse(String(url), init)))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})

beforeEach(() => {})
afterEach(() => {})
