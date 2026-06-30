import { vi } from 'vitest'
import { describeConnectorConformance } from '@anway/agent/testing'
import type { IKnowledgeGraph } from '@anway/agent'
import { JenkinsBootstrap } from './bootstrap.js'

const MOCK = 'http://mock-jenkins.local'

const JOBS = {
  jobs: [
    {
      name: 'payments-deploy',
      url: 'http://mock-jenkins.local/job/payments-deploy',
      lastBuild: { number: 42, result: 'SUCCESS', timestamp: 1 },
    },
  ],
}

describeConnectorConformance('jenkins', {
  makeBootstrap: (kg: IKnowledgeGraph) => new JenkinsBootstrap(kg),
  validPayload: { baseUrl: MOCK, user: 'admin', apiToken: 'tok' },
  unreachablePayload: { baseUrl: 'http://unreachable.invalid', user: 'a', apiToken: 't' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (!u.startsWith(MOCK)) throw new Error(`ECONNREFUSED ${u}`)
      if (u.includes('/api/json')) return new Response(JSON.stringify(JOBS), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})
