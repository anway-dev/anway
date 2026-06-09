import { describe, it, expect } from 'vitest'

describe('ConfluenceBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.ConfluenceBootstrap).toBeDefined()
  })
})
