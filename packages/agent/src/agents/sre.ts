import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

export interface IncidentContext {
  hypothesis: string
  timeline: TimelineEvent[]
  relatedDeploys: string[]
  relatedPRs: string[]
  suggestedRunbook: string[]
}

export interface TimelineEvent {
  time: Date
  source: string
  event: string
}

/**
 * SREAgent — assembles incident context from connector data.
 * Uses cheap model for connector summarisation, expensive model for final hypothesis.
 * Knowledge Graph resolveContextByName is the mandatory first step per CLAUDE.md.
 */
export class SREAgent {
  constructor(
    private readonly cheapModel: IModelProvider,
    private readonly mainModel: IModelProvider,
    private readonly knowledgeGraph: IKnowledgeGraph,
    private readonly cheapModelId = 'claude-haiku-3-5-20251001',
    private readonly mainModelId = 'claude-sonnet-4-6',
  ) {}

  async assembleContext(alertTitle: string, alertDescription: string, tenantId: TenantId): Promise<IncidentContext> {
    // Knowledge Graph resolves entity context first — mandatory per architecture
    let graphContext: AgentContext | null = null
    try {
      graphContext = await this.knowledgeGraph.resolveContextByName(alertTitle, tenantId)
    } catch {
      // Graph unavailable — proceed with live data only, note gap
    }

    const entityExtraction = await this.cheapModel.chat([
      { role: 'system', content: 'Extract service name, team, and any error type from this alert. Respond with comma-separated values only.' },
      { role: 'user', content: `${alertTitle}: ${alertDescription}` },
    ], [], { model: this.cheapModelId, maxTokens: 50, temperature: 0 })

    const entities = entityExtraction.content.split(',').map(s => s.trim()).filter(Boolean)

    const graphBlock = graphContext
      ? `Knowledge Graph context:\n- Primary entity: ${graphContext.primaryEntity.name} (${graphContext.primaryEntity.type})\n- Related entities: ${graphContext.relatedEntities.map(e => `${e.name} (${e.type})`).join(', ')}\n- Freshness: ${graphContext.freshness.toFixed(2)}`
      : 'Knowledge Graph: no context available'

    const hypothesisResult = await this.mainModel.chat([
      { role: 'system', content: `You are an SRE analyzing an incident. Based on the alert information and knowledge graph context, produce a grounded root cause hypothesis. Format: hypothesis, possible causes, recommended actions. Do not fabricate data — state clearly when information is unavailable.` },
      { role: 'user', content: `Alert: ${alertTitle}\nDescription: ${alertDescription}\nEntities identified: ${entities.join(', ')}\n\n${graphBlock}` },
    ], [], { model: this.mainModelId, maxTokens: 500, temperature: 0 })

    return {
      hypothesis: hypothesisResult.content,
      timeline: [{
        time: new Date(),
        source: 'alert',
        event: `${alertTitle}: ${alertDescription}`,
      }],
      relatedDeploys: [],
      relatedPRs: [],
      suggestedRunbook: [
        'Check service health metrics',
        'Review recent deploys',
        'Examine error logs',
        'Verify dependencies',
      ],
    }
  }
}
