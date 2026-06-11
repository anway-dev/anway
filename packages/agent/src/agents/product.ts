import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

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

    try { return JSON.parse(result.content) as PRD } catch { return { title: featureRequest, problem: '', goals: [], nonGoals: [], userStories: [], successMetrics: [], openQuestions: [] } }
  }
}
