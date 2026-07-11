import { describe, it, expect } from 'vitest'
import { makeRegistrationTools } from './registration-tools.js'

// Regression: during the first manual test the model called
// register_connector with a graph-entity UUID as both the connector name and
// the cli binary, plus an empty allowedSubcommands list — and the L2 gate
// dutifully asked a human to approve garbage. Validation must reject
// incoherent args BEFORE the gate ever fires.

const TENANT = '00000000-0000-0000-0000-000000000001'
const UUID = 'c6f4a101-9feb-4243-a212-ca5a86b7e840'

function registerTool(role: 'admin' | 'dev' = 'admin') {
  const tool = makeRegistrationTools(TENANT, role).find(t => t.name === 'register_connector')!
  expect(tool).toBeDefined()
  return tool
}

describe('register_connector argument validation', () => {
  it('rejects a UUID-shaped connector name', async () => {
    await expect(registerTool().run({ type: 'cli', name: UUID, config: { binary: 'gh', allowedSubcommands: ['pr list'] } }))
      .rejects.toThrow(/not a valid connector name/)
  })

  it('rejects a UUID-shaped cli binary', async () => {
    await expect(registerTool().run({ type: 'cli', name: 'payments', config: { binary: UUID, allowedSubcommands: ['x'] } }))
      .rejects.toThrow(/not a valid CLI binary/)
  })

  it('rejects an empty allowedSubcommands list for cli connectors', async () => {
    await expect(registerTool().run({ type: 'cli', name: 'github', config: { binary: 'gh', allowedSubcommands: [] } }))
      .rejects.toThrow(/non-empty allowedSubcommands/)
  })

  it('rejects mcp config without a url', async () => {
    await expect(registerTool().run({ type: 'mcp', name: 'linear', config: {} }))
      .rejects.toThrow(/require config\.url/)
  })

  it('still requires admin role before any validation', async () => {
    await expect(registerTool('dev').run({ type: 'cli', name: UUID, config: {} }))
      .rejects.toThrow(/requires admin role/)
  })
})
