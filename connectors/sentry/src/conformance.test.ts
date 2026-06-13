import { vi } from 'vitest'
import { describeConnectorConformance } from '@anvay/agent/testing'
import type { IKnowledgeGraph } from '@anvay/agent'
import { SentryBootstrap } from './bootstrap.js'

const MOCK = 'https://mock-sentry.local'

const PROJECTS = [
  { id: '1', slug: 'payments-api', name: 'Payments' },
]
const ISSUES = [
  { id: '99', title: 'TypeError x', culprit: 'pay.js' },
]

describeConnectorConformance('sentry', {
  makeBootstrap: (kg: IKnowledgeGraph) => new SentryBootstrap(kg),
  validPayload: { token: 't', org: 'acme', baseUrl: MOCK },
  unreachablePayload: { token: 't', org: 'acme', baseUrl: 'https://unreachable.invalid' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (!u.startsWith(MOCK)) throw new Error(`ECONNREFUSED ${u}`)
      if (u.includes('/projects/') && u.includes('/issues/')) return new Response(JSON.stringify(ISSUES), { status: 200 })
      if (u.includes('/projects/')) return new Response(JSON.stringify(PROJECTS), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})
