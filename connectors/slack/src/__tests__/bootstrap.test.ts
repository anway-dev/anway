import { describe, it, expect } from 'vitest'

describe('SlackBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.SlackBootstrap).toBeDefined()
  })
})
