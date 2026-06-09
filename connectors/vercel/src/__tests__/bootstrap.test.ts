import { describe, it, expect } from 'vitest'

describe('VercelBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.VercelBootstrap).toBeDefined()
  })
})
