import { describe, it, expect } from 'vitest'

describe('JenkinsBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.JenkinsBootstrap).toBeDefined()
  })
})
