import { describe, it, expect } from 'vitest'

describe('ElasticsearchBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.ElasticsearchBootstrap).toBeDefined()
  })
})
