import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

const execFileAsync = promisify(execFile)

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

export class SREAgent {
  constructor(
    private readonly cheapModel: IModelProvider,
    private readonly mainModel: IModelProvider,
    private readonly knowledgeGraph: IKnowledgeGraph,
    private readonly cheapModelId = this.cheapModel.cheapModelId,
    private readonly mainModelId = this.mainModel.modelId,
  ) {}

  async assembleContext(alertTitle: string, alertDescription: string, tenantId: TenantId): Promise<IncidentContext> {
    let graphContext: AgentContext | null = null
    try {
      graphContext = await this.knowledgeGraph.resolveContextByName(alertTitle, tenantId)
    } catch { /* proceed with live data */ }

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

    // Populate from graph relationships + live connector calls
    const relatedDeploys: string[] = []
    const relatedPRs: string[] = []
    if (graphContext) {
      for (const rel of graphContext.relationships) {
        if (rel.relType === 'DEPLOYED_TO') {
          const deployEntity = graphContext.relatedEntities.find(e => e.id === rel.fromEntityId)
          if (deployEntity?.name) relatedDeploys.push(deployEntity.name)
        }
      }

      // Live ArgoCD calls via CLI
      const argoCoords = graphContext.connectorCoordinates?.['argocd'] as { resourceIds?: Record<string, string> } | undefined
      if (argoCoords?.resourceIds) {
        const appName = argoCoords.resourceIds['appName'] ?? argoCoords.resourceIds['service'] ?? graphContext.primaryEntity.name
        try {
          const { stdout } = await execFileAsync('argocd', ['app', 'history', appName, '-o', 'json'], { timeout: 10_000 })
          const history = JSON.parse(stdout) as Array<{ revision?: string; deployedAt?: string; status?: string }>
          for (const h of history.slice(0, 3)) {
            relatedDeploys.push(`${h.revision ?? 'unknown'} @ ${h.deployedAt ?? '?'} (${h.status ?? '?'})`)
          }
        } catch { /* ArgoCD CLI unavailable */ }
      }

      // Live GitHub calls via CLI
      const ghCoords = graphContext.connectorCoordinates?.['github'] as { resourceIds?: Record<string, string> } | undefined
      if (ghCoords?.resourceIds?.['repo']) {
        try {
          const { stdout } = await execFileAsync('gh', ['pr', 'list', '--repo', ghCoords.resourceIds['repo'], '--limit', '5', '--json', 'number,title,mergedAt,state'], { timeout: 10_000 })
          const prs = JSON.parse(stdout) as Array<{ number: number; title: string; mergedAt?: string; state: string }>
          for (const pr of prs) {
            relatedPRs.push(`PR#${pr.number}: ${pr.title} (${pr.state})`)
          }
        } catch { /* GitHub CLI unavailable */ }
      }
    }

    // Dynamic runbook based on available data
    const suggestedRunbook = ['Check service health metrics in Datadog']
    if (relatedDeploys.length > 0) suggestedRunbook.push(`Review recent deploy: ${relatedDeploys[0]}`)
    if (relatedPRs.length > 0) suggestedRunbook.push(`Review recently merged PR: ${relatedPRs[0]}`)
    suggestedRunbook.push('Examine error logs (Loki/Datadog)', 'Verify upstream dependencies')

    return {
      hypothesis: hypothesisResult.content,
      timeline: [{ time: new Date(), source: 'alert', event: `${alertTitle}: ${alertDescription}` }],
      relatedDeploys,
      relatedPRs,
      suggestedRunbook,
    }
  }
}
