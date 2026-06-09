import { describe, it, expect } from 'vitest'

describe('SonarQubeBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.SonarQubeBootstrap).toBeDefined()
  })
})
