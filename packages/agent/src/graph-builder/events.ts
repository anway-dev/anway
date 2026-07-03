/**
 * Graph event types — emitted by connectors and handled by GraphBuilderAgent.
 * Every event carries tenantId for RLS scoping.
 */

export type GraphEvent =
  | ConnectorRegistered
  | ConnectorReconnected
  | ConnectorRemoved
  | PrMerged
  | IncidentCreated
  | DeployCompleted
  | DeployTrigger
  | TicketCreated
  | ProjectCreated
  | RepoCreated
  | NamespaceCreated
  | ResourceAdded
  | TeamChanged
  | OncallRotation
  | ConnectorCapabilityChanged

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

export interface ConnectorReconnected {
  type: 'connector_reconnected'
  connectorId: string
  connectorType: string
  tenantId: string
  payload: Record<string, unknown>
}

export interface ConnectorRemoved {
  type: 'connector_removed'
  tenantId: string
  connectorType: string
  connectorId: string
}

export interface DeployTrigger {
  type: 'deploy_trigger'
  tenantId: string
  service: string
  sha: string
  imageUri: string
  repo: string
  environment: string
  triggeredBy: string
  workflowRun?: string
  commitMessage?: string
}

export interface TicketCreated {
  type: 'ticket_created'
  tenantId: string
  ticketId: string
  title: string
  description: string
  labels: string[]
}

// T17 — previously missing lifecycle event types
export interface ProjectCreated {
  type: 'project_created'
  tenantId: string
  projectId: string
  name: string
  teamId?: string
}

export interface RepoCreated {
  type: 'repo_created'
  tenantId: string
  repoId: string
  name: string
  language?: string
  org?: string
}

export interface NamespaceCreated {
  type: 'namespace_created'
  tenantId: string
  name: string
  services?: string[]
}

export interface ResourceAdded {
  type: 'resource_added'
  tenantId: string
  resourceId: string
  resourceType: string
  tags?: Record<string, string>
  service?: string
  team?: string
}

export interface TeamChanged {
  type: 'team_changed'
  tenantId: string
  teamId: string
  name: string
  members?: string[]
  slackChannel?: string
}

export interface OncallRotation {
  type: 'oncall_rotation'
  tenantId: string
  teamId: string
  engineerId: string
  engineerName?: string
  validFrom: string
  validTo?: string
}

export interface ConnectorCapabilityChanged {
  type: 'connector_capability_changed'
  tenantId: string
  connectorId: string
  connectorType: string
  previousManifest?: Record<string, unknown>
  newManifest?: Record<string, unknown>
}
