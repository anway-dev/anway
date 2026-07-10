import { describe, it, expect } from 'vitest'

describe('KubernetesBootstrap', () => {
  // 30s: the @kubernetes/client-node import graph alone takes >5s on a cold
  // CI runner (confirmed on real Actions run 29089473803 — plain import
  // timed out vitest's 5s default; instant locally with a warm cache).
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.KubernetesBootstrap).toBeDefined()
  }, 30_000)
})
