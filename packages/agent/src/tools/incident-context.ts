import type { ExecutableTool } from '../orchestrator.js'
import type { IKnowledgeGraph } from '../interfaces/knowledge-graph.js'
import type { IModelProvider } from '../interfaces/provider.js'
import { TenantId } from '@anvay/types'
import { SREAgent } from '../agents/sre.js'
import type { IncidentContext } from '../agents/sre.js'

export type { IncidentContext }

interface IncidentRecord {
  id: string
  tenantId: string
  title: string
  severity: string
  status: string
  description?: string | null
}

/**
 * Factory that creates the get_incident_context ExecutableTool.
 * Graph-first: resolveContextByName before SRE agent assembles hypothesis.
 * getIncident is injected so the tool has no direct DB dependency.
 */
export function createGetIncidentContextTool(
  knowledgeGraph: IKnowledgeGraph,
  cheapModel: IModelProvider,
  mainModel: IModelProvider,
  getIncident: (id: string, tenantId: string) => Promise<IncidentRecord | null>,
): ExecutableTool {
  const sreAgent = new SREAgent(cheapModel, mainModel, knowledgeGraph)

  return {
    name: 'get_incident_context',
    description:
      'Assembles full incident context. Graph-first: resolves Knowledge Graph entity context before SRE analysis. ' +
      'Returns root cause hypothesis, timeline, related deploys, runbook suggestions.',
    parameters: {
      type: 'object',
      properties: {
        incidentId: { type: 'string', description: 'UUID of the incident to analyse' },
        tenantId: { type: 'string', description: 'Tenant UUID' },
      },
      required: ['incidentId', 'tenantId'],
    },
    async run(args) {
      const { incidentId, tenantId } = args as { incidentId: string; tenantId: string }

      const incident = await getIncident(incidentId, tenantId)
      if (!incident) {
        return { error: `Incident ${incidentId} not found` }
      }

      const description = incident.description ?? ''
      const context: IncidentContext = await sreAgent.assembleContext(
        incident.title,
        description,
        TenantId(tenantId),
      )

      return {
        incidentId,
        title: incident.title,
        severity: incident.severity,
        status: incident.status,
        graphContextAvailable: false,
        graphFreshness: 0,
        ...context,
      }
    },
  }
}
