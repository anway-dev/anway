import { describe, it, expect } from 'vitest'

describe('OpsGenieBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.OpsGenieBootstrap).toBeDefined()
  })
})
