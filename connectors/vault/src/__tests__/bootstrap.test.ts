import { describe, it, expect } from 'vitest'

describe('VaultBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.VaultBootstrap).toBeDefined()
  })
})
