import { describe, it, expect } from 'vitest'

describe('JiraBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.JiraBootstrap).toBeDefined()
  })
})
