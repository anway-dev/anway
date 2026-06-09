import { describe, it, expect } from 'vitest'

describe('PagerDutyBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.PagerDutyBootstrap).toBeDefined()
  })
})
