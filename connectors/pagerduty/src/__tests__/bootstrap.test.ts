import { describe, it, expect } from 'vitest'

describe('PagerdutyBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.PagerdutyBootstrap).toBeDefined()
  })
})
