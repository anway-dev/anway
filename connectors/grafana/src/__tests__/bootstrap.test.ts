import { describe, it, expect } from 'vitest'

describe('GrafanaBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.GrafanaBootstrap).toBeDefined()
  })
})
