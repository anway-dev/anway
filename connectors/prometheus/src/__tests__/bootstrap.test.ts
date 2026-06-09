import { describe, it, expect } from 'vitest'

describe('PrometheusBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.PrometheusBootstrap).toBeDefined()
  })
})
