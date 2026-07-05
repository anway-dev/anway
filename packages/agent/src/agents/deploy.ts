import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
import { extractJson } from './extract-json.js'

export interface DeployPlan { service: string; environment: string; strategy: 'rolling' | 'blue_green' | 'canary'; preChecks: string[]; postChecks: string[]; rollbackTriggers: string[]; estimatedDuration: string; confidence: number }

export class DeployAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async planDeploy(service: string, env: string, sha: string, tenantId: TenantId): Promise<DeployPlan> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(service, tenantId) } catch {}

    const history = await this.cheapModel.chat([
      { role: 'system', content: 'Extract deploy history, recent incidents, and failure rate from context.' },
      { role: 'user', content: `Service: ${service}. ${graphContext ? 'Recent episodes: ' + graphContext.recentEpisodes.slice(0, 3).map(e => e.text).join(' | ') : 'No graph context'}` },
    ], [], { model: this.cheapModel.cheapModelId, maxTokens: 100, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate deploy plan in JSON matching { service, environment, strategy: "rolling"|"blue_green"|"canary", preChecks: string[], postChecks: string[], rollbackTriggers: string[], estimatedDuration, confidence: number }. Return ONLY valid JSON.' },
      { role: 'user', content: `Service: ${service}\nEnv: ${env}\nSHA: ${sha}\nHistory: ${history.content}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 1000, temperature: 0 })

    try { return extractJson<DeployPlan>(result.content) } catch { return { service, environment: env, strategy: 'rolling', preChecks: [], postChecks: [], rollbackTriggers: [], estimatedDuration: '10m', confidence: 0.5 } }
  }
}
