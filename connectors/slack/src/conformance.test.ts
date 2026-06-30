import { vi } from 'vitest'
import { describeConnectorConformance } from '@anway/agent/testing'
import type { IKnowledgeGraph } from '@anway/agent'
import { SlackBootstrap } from './bootstrap.js'

const MOCK = 'https://mock-slack.local'

const CHANNELS = {
  channels: [
    { id: 'C1', name: 'payments' },
    { id: 'C2', name: 'checkout' },
  ],
}

describeConnectorConformance('slack', {
  makeBootstrap: (kg: IKnowledgeGraph) => new SlackBootstrap(kg),
  validPayload: { token: 'xoxb-test', baseUrl: MOCK },
  unreachablePayload: { token: 'x', baseUrl: 'https://unreachable.invalid' },
  setupMock: () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (!u.startsWith(MOCK)) throw new Error(`ECONNREFUSED ${u}`)
      if (u.includes('/api/conversations.list')) return new Response(JSON.stringify(CHANNELS), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
  },
  teardownMock: () => { vi.unstubAllGlobals() },
})
