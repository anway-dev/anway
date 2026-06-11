/**
 * Graph event types — emitted by connectors and handled by GraphBuilderAgent.
 * Every event carries tenantId for RLS scoping.
 */

export type GraphEvent =
  | ConnectorRegistered
  | ConnectorRemoved
  | PrMerged
  | IncidentCreated
  | DeployCompleted
  | TicketCreated

export interface ConnectorRegistered {
  type: 'connector_registered'
  connectorId: string
  connectorType: string
  tenantId: string
  payload: Record<string, unknown>
}

export interface PrMerged {
  type: 'pr_merged'
  tenantId: string
  repo: string
  sha: string
  branch: string
  message: string
  author: string
}

export interface IncidentCreated {
  type: 'incident_created'
  tenantId: string
  incidentId: string
  title: string
  severity: string
  serviceHint?: string
}

export interface DeployCompleted {
  type: 'deploy_completed'
  tenantId: string
  service: string
  sha: string
  env: string
  status: 'success' | 'failed'
}

export interface ConnectorRemoved {
  type: 'connector_removed'
  tenantId: string
  connectorType: string
  connectorId: string
}

export interface TicketCreated {
  type: 'ticket_created'
  tenantId: string
  ticketId: string
  title: string
  description: string
  labels: string[]
}
