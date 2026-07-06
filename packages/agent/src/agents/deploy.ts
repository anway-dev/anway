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

    // See agents/product.ts writePRD for why this throws instead of
    // returning a fabricated-looking empty stub on parse failure.
    let plan: DeployPlan
    try { plan = extractJson<DeployPlan>(result.content) } catch (e) { throw new Error(`DeployAgent: failed to parse DeployPlan JSON from model response: ${e instanceof Error ? e.message : String(e)}`) }
    // The LLM-supplied confidence was previously used verbatim, unvalidated —
    // could be >1, negative, or not even a number if the model deviates from
    // the requested schema. Clamp to the real 0.0-1.0 range this project's
    // confidence values are documented to be everywhere else.
    const rawConfidence = typeof plan.confidence === 'number' && Number.isFinite(plan.confidence) ? plan.confidence : 0.5
    plan.confidence = Math.max(0, Math.min(1, rawConfidence))
    return plan
  }
}
