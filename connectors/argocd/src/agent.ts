// ArgoCD ConnectorAgent — specialist agent with ArgoCD connector tools.
import { createSpecialistAgent } from '@anvay/agent'
import type { SpecialistAgent, SpecialistAgentConfig } from '@anvay/agent'
import { ArgoCDConnector } from './connector.js'
import { makeArgoCDTools } from './tools.js'

export function createArgoCDAgent(
  perimeter: SpecialistAgentConfig['perimeter'],
  auditSink: SpecialistAgentConfig['auditSink'],
  model: SpecialistAgentConfig['model'],
): SpecialistAgent {
  const connector = new ArgoCDConnector('argocd-prod')
  return createSpecialistAgent({
    name: 'argocd',
    model,
    tools: makeArgoCDTools(connector),
    systemPrompt: 'You are an ArgoCD deployment specialist. Use list_applications and get_sync_status to answer deployment questions.',
    perimeter,
    auditSink,
  })
}
