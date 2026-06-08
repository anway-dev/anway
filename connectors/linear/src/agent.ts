// Linear ConnectorAgent — specialist agent with Linear connector tools.
import { createSpecialistAgent } from '@anvay/agent'
import type { SpecialistAgent, SpecialistAgentConfig } from '@anvay/agent'
import { LinearConnector } from './connector.js'
import { makeLinearTools } from './tools.js'

export function createLinearAgent(
  perimeter: SpecialistAgentConfig['perimeter'],
  auditSink: SpecialistAgentConfig['auditSink'],
  model: SpecialistAgentConfig['model'],
): SpecialistAgent {
  return createSpecialistAgent({
    name: 'linear',
    model,
    tools: makeLinearTools(new LinearConnector('linear-prod')),
    systemPrompt: 'You are a Linear project management specialist. Use list_issues and get_issue to answer product and engineering questions.',
    perimeter,
    auditSink,
  })
}
