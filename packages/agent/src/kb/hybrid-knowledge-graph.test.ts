import { describe, it, expect, vi } from 'vitest'
import { HybridKnowledgeGraph } from './hybrid-knowledge-graph.js'
import { StructuralGraph } from './structural-graph.js'
import { GraphitiClient } from './graphiti-client.js'
import type { Fact, KBEntry, Episode, Entity, Relationship, AgentContext } from '../interfaces/knowledge-graph.js'

function makeStructural(): StructuralGraph {
  const s = new StructuralGraph(async () => [])
  return s
}

function makeGraphiti(): GraphitiClient {
  const g = new GraphitiClient({ baseUrl: 'http://localhost:8000', tenantId: 't-1' })
  return g
}

describe('HybridKnowledgeGraph', () => {
  it('addEpisode delegates to GraphitiClient', async () => {
    const structural = makeStructural()
    const graphiti = makeGraphiti()
    vi.spyOn(graphiti, 'addEpisode').mockResolvedValue(undefined)
    const kg = new HybridKnowledgeGraph(structural, graphiti)

    const episode: Episode = { text: 'test', source: 's', timestamp: new Date() }
    await kg.addEpisode(episode)
    expect(graphiti.addEpisode).toHaveBeenCalledWith(episode)
  })

  it('getFacts delegates to GraphitiClient', async () => {
    const structural = makeStructural()
    const graphiti = makeGraphiti()
    const facts: Fact[] = [{ claim: 'test', source: 's', validFrom: new Date() }]
    vi.spyOn(graphiti, 'getFacts').mockResolvedValue(facts)
    const kg = new HybridKnowledgeGraph(structural, graphiti)

    const result = await kg.getFacts('test')
    expect(result).toEqual(facts)
  })

  it('getFacts returns [] when no GraphitiClient', async () => {
    const structural = makeStructural()
    const kg = new HybridKnowledgeGraph(structural)
    expect(await kg.getFacts('test')).toEqual([])
  })

  it('search maps facts to KBEntry shape', async () => {
    const structural = makeStructural()
    const graphiti = makeGraphiti()
    vi.spyOn(graphiti, 'getFacts').mockResolvedValue([
      { claim: 'found', source: 's', validFrom: new Date() },
    ])
    const kg = new HybridKnowledgeGraph(structural, graphiti)

    const results = await kg.search('q', 't-1' as any, 10)
    expect(results[0]?.content).toBe('found')
    expect(results[0]?.source).toBe('graphiti')
  })
})
