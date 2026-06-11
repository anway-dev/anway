import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'
import type { PRD } from './product.js'

export interface Component { name: string; responsibility: string; technology: string }
export interface APIChange { method: string; path: string; description: string; breaking: boolean }

export interface TechSpec {
  title: string; overview: string; architecture: string; components: Component[]
  dataModel: string; apiChanges: APIChange[]; securityConsiderations: string[]
  testPlan: string; rolloutPlan: string; estimatedComplexity: 'low' | 'medium' | 'high'
}

export class TechSpecAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async writeTechSpec(prd: PRD, tenantId: TenantId): Promise<TechSpec> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(prd.title, tenantId) } catch {}

    const extracted = await this.cheapModel.chat([
      { role: 'system', content: 'Extract existing service names and components from context. Respond comma-separated.' },
      { role: 'user', content: `PRD: ${prd.title}\n${graphContext ? 'Related: ' + graphContext.relatedEntities.map(e => e.name).join(', ') : ''}` },
    ], [], { model: this.cheapModel.cheapModelId, maxTokens: 100, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Write a TechSpec in JSON matching { title, overview, architecture, components: [{name, responsibility, technology}], dataModel, apiChanges: [{method, path, description, breaking}], securityConsiderations: string[], testPlan, rolloutPlan, estimatedComplexity: "low"|"medium"|"high" }. Return ONLY valid JSON.' },
      { role: 'user', content: `PRD title: ${prd.title}\nGoals: ${prd.goals.join(', ')}\nExisting: ${extracted.content}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as TechSpec } catch { return { title: prd.title, overview: '', architecture: '', components: [], dataModel: '', apiChanges: [], securityConsiderations: [], testPlan: '', rolloutPlan: '', estimatedComplexity: 'medium' } }
  }
}
