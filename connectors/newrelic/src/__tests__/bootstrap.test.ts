import { describe, it, expect } from 'vitest'

describe('NewRelicBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.NewRelicBootstrap).toBeDefined()
  })
})
