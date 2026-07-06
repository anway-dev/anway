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

  // Regression test for finding I5: search() previously never called
  // StructuralGraph.search() at all — with Graphiti configured it returned
  // Graphiti facts only, and without Graphiti it returned [] unconditionally,
  // completely orphaning StructuralGraph's real pgvector semantic search.
  it('search delegates to StructuralGraph.search when no GraphitiClient is configured', async () => {
    const structural = makeStructural()
    const semanticHit: KBEntry = {
      id: 'kb-1', tenantId: 't-1', source: 'pgvector', fetchedAt: new Date(),
      ttlSeconds: 3600, freshnessScore: 0.9, content: 'semantic result',
    }
    vi.spyOn(structural, 'search').mockResolvedValue([semanticHit])
    const kg = new HybridKnowledgeGraph(structural)

    const results = await kg.search('q', 't-1' as any, 10)
    expect(structural.search).toHaveBeenCalledWith('q', 't-1', 10)
    expect(results).toEqual([semanticHit])
  })

  it('search merges Graphiti facts with StructuralGraph semantic hits, deduped, capped at topK', async () => {
    const structural = makeStructural()
    const graphiti = makeGraphiti()
    vi.spyOn(graphiti, 'getFacts').mockResolvedValue([
      { claim: 'temporal fact', source: 's', validFrom: new Date() },
    ])
    const semanticHits: KBEntry[] = [
      { id: '1', tenantId: 't-1', source: 'pgvector', fetchedAt: new Date(), ttlSeconds: 3600, freshnessScore: 0.9, content: 'temporal fact' }, // duplicate of graphiti fact — should be deduped
      { id: '2', tenantId: 't-1', source: 'pgvector', fetchedAt: new Date(), ttlSeconds: 3600, freshnessScore: 0.8, content: 'semantic result 2' },
    ]
    vi.spyOn(structural, 'search').mockResolvedValue(semanticHits)
    const kg = new HybridKnowledgeGraph(structural, graphiti)

    const results = await kg.search('q', 't-1' as any, 2)
    expect(results).toHaveLength(2)
    expect(results[0]?.content).toBe('temporal fact')
    expect(results[0]?.source).toBe('graphiti')
    expect(results[1]?.content).toBe('semantic result 2')
  })
})
