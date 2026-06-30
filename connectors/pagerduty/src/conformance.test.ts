import { vi } from 'vitest'
import { describeConnectorConformance } from '@anway/agent/testing'
import type { IKnowledgeGraph } from '@anway/agent'
import { PagerdutyBootstrap } from './bootstrap.js'

const MOCK = 'https://mock-pd.local'

const USERS = { users: [{ id: 'U1', name: 'Alice', email: 'a@x.io' }] }
const TEAMS = { teams: [{ id: 'T1', name: 'Payments' }] }
const ONCALLS = {
  oncalls: [{ user: { id: 'U1', summary: 'Alice' }, escalation_policy: { summary: 'Payments' } }],
}

describeConnectorConformance('pagerduty', {
  makeBootstrap: (kg: IKnowledgeGraph) => new PagerdutyBootstrap(kg),
  validPayload: { token: 'tok', baseUrl: MOCK },
  unreachablePayload: { token: 't', baseUrl: 'https://unreachable.invalid' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (!u.startsWith(MOCK)) throw new Error(`ECONNREFUSED ${u}`)
      if (u.includes('/users')) return new Response(JSON.stringify(USERS), { status: 200 })
      if (u.includes('/teams')) return new Response(JSON.stringify(TEAMS), { status: 200 })
      if (u.includes('/oncalls')) return new Response(JSON.stringify(ONCALLS), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})
