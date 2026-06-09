import { describe, it, expect } from 'vitest'

describe('CircleCIBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.CircleCIBootstrap).toBeDefined()
  })
})
