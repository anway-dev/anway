import { describe, it, expect } from 'vitest'
import { EksAgent } from './agent.js'
import { KubernetesBootstrap } from '@anway/connector-k8s'

describe('eks conformance', () => {
  it('agent exposes tools', () => {
    const agent = new EksAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('eks')
  })

  it('agent tools have valid definitions', () => {
    const agent = new EksAgent()
    for (const tool of agent.tools) {
      expect(tool.definition.name).toBeTruthy()
      expect(tool.definition.description).toBeTruthy()
      expect(tool.definition.parameters).toBeDefined()
    }
  })

  it('bootstrap class exists and is constructable', () => {
    const bs = new KubernetesBootstrap({} as any)
    expect(bs).toBeDefined()
    expect(typeof bs.bootstrap).toBe('function')
  })
})
