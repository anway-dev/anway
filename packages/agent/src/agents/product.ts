import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
import { extractJson } from './extract-json.js'

export interface UserStory {
  persona: string
  action: string
  outcome: string
  acceptance: string[]
}

export interface PRD {
  title: string
  problem: string
  goals: string[]
  nonGoals: string[]
  userStories: UserStory[]
  successMetrics: string[]
  openQuestions: string[]
}

export class ProductAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async writePRD(featureRequest: string, tenantId: TenantId): Promise<PRD> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(featureRequest, tenantId) } catch {}

    const extraction = await this.cheapModel.chat([
      { role: 'system', content: 'Extract persona, primary goal, and constraints from this feature request. Respond with comma-separated values only.' },
      { role: 'user', content: featureRequest },
    ], [], { model: this.cheapModel.cheapModelId, maxTokens: 100, temperature: 0 })

    const graphBlock = graphContext
      ? `Context: ${graphContext.primaryEntity.name} (${graphContext.primaryEntity.type}). Related: ${graphContext.relatedEntities.map(e => e.name).join(', ')}`
      : ''

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Write a structured PRD in JSON matching interface { title, problem, goals: string[], nonGoals: string[], userStories: { persona, action, outcome, acceptance: string[] }[], successMetrics: string[], openQuestions: string[] }. Return ONLY valid JSON.' },
      { role: 'user', content: `Feature request: ${featureRequest}\nExtracted: ${extraction.content}\n${graphBlock}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 2000, temperature: 0 })

    // Was silently returning an empty-but-real-looking PRD on parse failure,
    // indistinguishable from the model genuinely producing a minimal one —
    // confirmed live via independent review, callers (routes/lifecycle.ts)
    // already correctly try/catch this call into a real 502 error response,
    // so throwing here surfaces a genuine failure instead of a fabricated
    // "success" the caller can't tell apart from real (if sparse) content.
    try { return extractJson<PRD>(result.content) } catch (e) { throw new Error(`ProductAgent: failed to parse PRD JSON from model response: ${e instanceof Error ? e.message : String(e)}`) }
  }
}
