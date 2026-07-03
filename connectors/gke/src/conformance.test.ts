import { describe, it, expect } from 'vitest'
import { GkeAgent } from './agent.js'
import { KubernetesBootstrap } from '@anway/connector-k8s'

describe('gke conformance', () => {
  it('agent exposes tools', () => {
    const agent = new GkeAgent()
    expect(agent.tools.length).toBeGreaterThan(0)
    expect(agent.connectorType).toBe('gke')
  })

  it('agent tools have valid definitions', () => {
    const agent = new GkeAgent()
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
