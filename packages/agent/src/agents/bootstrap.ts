import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'
import type { TechSpec } from './techspec.js'

export interface FileToCreate { path: string; description: string; template: string }
export interface BootstrapPlan { service: string; files: FileToCreate[]; commands: string[]; prDescription: string }

export class BootstrapAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async planBootstrap(spec: TechSpec, tenantId: TenantId): Promise<BootstrapPlan> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(spec.title, tenantId) } catch {}

    const langExtraction = await this.cheapModel.chat([
      { role: 'system', content: 'Identify language, framework, and stack from this context. Respond comma-separated.' },
      { role: 'user', content: `TechSpec: ${spec.title}. Architecture: ${spec.architecture}. ${graphContext ? 'Existing: ' + graphContext.relatedEntities.map(e => e.name).join(', ') : ''}` },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 100, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate a bootstrap plan in JSON matching { service: string, files: [{path, description, template}], commands: string[], prDescription: string }. Return ONLY valid JSON.' },
      { role: 'user', content: `Service: ${spec.title}\nArchitecture: ${spec.architecture}\nComponents: ${spec.components.map(c => c.name).join(', ')}\nStack: ${langExtraction.content}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as BootstrapPlan } catch { return { service: spec.title, files: [], commands: [], prDescription: '' } }
  }
}
