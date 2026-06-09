import { describe, it, expect } from 'vitest'

describe('DynatraceBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.DynatraceBootstrap).toBeDefined()
  })
})
