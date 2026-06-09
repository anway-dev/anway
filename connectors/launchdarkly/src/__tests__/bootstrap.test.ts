import { describe, it, expect } from 'vitest'

describe('LaunchDarklyBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.LaunchDarklyBootstrap).toBeDefined()
  })
})
