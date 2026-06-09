import { describe, it, expect } from 'vitest'

describe('LokiBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.LokiBootstrap).toBeDefined()
  })
})
