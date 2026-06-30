import { vi, beforeEach, afterEach } from 'vitest'
import { describeConnectorConformance } from '@anway/agent/testing'
import type { IKnowledgeGraph } from '@anway/agent'
import { PrometheusBootstrap } from './bootstrap.js'

// Active-targets response the prometheus bootstrap expects.
const TARGETS_BODY = {
  data: {
    activeTargets: [
      { labels: { job: 'payments-api' } },
      { labels: { job: 'auth-service' } },
      { labels: { job: 'payments-api' } }, // dup job — must dedup
    ],
  },
}

const MOCK_HOST = 'http://mock-prom.local:9090'

describeConnectorConformance('prometheus', {
  makeBootstrap: (kg: IKnowledgeGraph) => new PrometheusBootstrap(kg),
  validPayload: { baseUrl: MOCK_HOST },
  unreachablePayload: { baseUrl: 'http://unreachable.invalid:9090' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.startsWith(MOCK_HOST)) {
        return new Response(JSON.stringify(TARGETS_BODY), { status: 200 })
      }
      // Any other host (the unreachable case) → reject like a network failure
      throw new Error(`ECONNREFUSED ${u}`)
    }))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})

// Keep lifecycle hooks referenced for clarity when run standalone.
beforeEach(() => {})
afterEach(() => {})
