import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
import { extractJson } from './extract-json.js'

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
    ], [], { model: this.cheapModel.cheapModelId, maxTokens: 10, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Answer business query in JSON matching { query, summary, metrics: [{label, value, trend?: "up"|"down"|"stable"}], insights: string[], recommendations: string[] }. Do not fabricate specific numbers, percentages, or metrics not grounded in the provided context — if no real underlying data is available, say so explicitly in summary and leave metrics empty rather than inventing plausible-sounding figures. Return ONLY valid JSON.' },
      { role: 'user', content: `Query: ${query}\nType: ${classification.content}\n${graphContext ? `Context: ${graphContext.primaryEntity.name} (${graphContext.primaryEntity.type}). Related: ${graphContext.relatedEntities.slice(0, 5).map(e => e.name).join(', ')}` : ''}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 1500, temperature: 0 })

    try { return extractJson<AnalysisReport>(result.content) } catch { return { query, summary: '', metrics: [], insights: [], recommendations: [] } }
  }
}
