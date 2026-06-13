import { vi } from 'vitest'
import { describeConnectorConformance } from '@anvay/agent/testing'
import type { IKnowledgeGraph } from '@anvay/agent'
import { JiraBootstrap } from './bootstrap.js'

const MOCK = 'https://mock-jira.atlassian.net'

const PROJECTS = {
  values: [
    { id: '10001', key: 'PAY', name: 'Payments', lead: { displayName: 'Alice' } },
    { id: '10002', key: 'CHK', name: 'Checkout' },
  ],
}
const ISSUES = {
  issues: [
    { id: '1', key: 'PAY-1', fields: { summary: 'Card decline', project: { key: 'PAY', name: 'Payments' }, assignee: { displayName: 'Bob' } } },
    { id: '2', key: 'PAY-2', fields: { summary: 'Refund bug', project: { key: 'PAY', name: 'Payments' }, assignee: null } },
  ],
}

describeConnectorConformance('jira', {
  makeBootstrap: (kg: IKnowledgeGraph) => new JiraBootstrap(kg),
  validPayload: { baseUrl: MOCK, email: 'dev@anvay.local', apiToken: 'token-123' },
  unreachablePayload: { baseUrl: 'https://unreachable.invalid', email: 'x@y.z', apiToken: 't' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (!u.startsWith(MOCK)) throw new Error(`ECONNREFUSED ${u}`)
      if (u.includes('/project/search')) return new Response(JSON.stringify(PROJECTS), { status: 200 })
      if (u.includes('/search?jql=')) return new Response(JSON.stringify(ISSUES), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})
