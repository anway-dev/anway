import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

export interface MetricPoint { label: string; value: string | number; trend?: 'up' | 'down' | 'stable' }
export interface AnalysisReport { query: string; summary: string; metrics: MetricPoint[]; insights: string[]; recommendations: string[] }

export class BAAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async analyze(query: string, tenantId: TenantId): Promise<AnalysisReport> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(query, tenantId) } catch {}

    const classification = await this.cheapModel.chat([
      { role: 'system', content: 'Classify this business query as: adoption|revenue|performance|usage|custom. Respond single word.' },
      { role: 'user', content: query },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 10, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Answer business query in JSON matching { query, summary, metrics: [{label, value, trend?: "up"|"down"|"stable"}], insights: string[], recommendations: string[] }. Return ONLY valid JSON.' },
      { role: 'user', content: `Query: ${query}\nType: ${classification.content}\n${graphContext ? `Context: ${graphContext.primaryEntity.name} (${graphContext.primaryEntity.type}). Related: ${graphContext.relatedEntities.slice(0, 5).map(e => e.name).join(', ')}` : ''}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 1500, temperature: 0 })

    try { return JSON.parse(result.content) as AnalysisReport } catch { return { query, summary: '', metrics: [], insights: [], recommendations: [] } }
  }
}
