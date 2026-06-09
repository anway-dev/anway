import { describe, it, expect } from 'vitest'

describe('SentryBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.SentryBootstrap).toBeDefined()
  })
})
