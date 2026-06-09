import { describe, it, expect } from 'vitest'

describe('SnykBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.SnykBootstrap).toBeDefined()
  })
})
