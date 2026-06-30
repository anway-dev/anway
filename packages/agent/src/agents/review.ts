import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'

export interface Finding { file: string; line?: number; severity: 'blocking' | 'high' | 'medium' | 'low'; description: string; suggestion: string }
export interface ReviewFindings { summary: string; blocking: Finding[]; nonBlocking: Finding[]; testPlan: string[]; approvalRecommendation: 'approve' | 'approve_with_changes' | 'request_changes' }

export class ReviewAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async review(diffSummary: string, prTitle: string, tenantId: TenantId): Promise<ReviewFindings> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(prTitle, tenantId) } catch {}

    const classification = await this.cheapModel.chat([
      { role: 'system', content: 'Classify this diff as security|perf|logic|style|docs. Respond single word.' },
      { role: 'user', content: diffSummary },
    ], [], { model: this.cheapModel.cheapModelId, maxTokens: 10, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Review code in JSON matching { summary, blocking: [{file, line?, severity: "blocking"|"high"|"medium"|"low", description, suggestion}], nonBlocking: [...], testPlan: string[], approvalRecommendation: "approve"|"approve_with_changes"|"request_changes" }. Return ONLY valid JSON.' },
      { role: 'user', content: `PR: ${prTitle}\nDiff type: ${classification.content}\n${graphContext ? 'Context: ' + graphContext.primaryEntity.name : ''}\n\n${diffSummary}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as ReviewFindings } catch { return { summary: '', blocking: [], nonBlocking: [], testPlan: [], approvalRecommendation: 'request_changes' } }
  }
}
