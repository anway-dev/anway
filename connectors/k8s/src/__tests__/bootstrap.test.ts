import { describe, it, expect } from 'vitest'

describe('KubernetesBootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.KubernetesBootstrap).toBeDefined()
  })
})
