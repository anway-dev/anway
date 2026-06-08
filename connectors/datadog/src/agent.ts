// Datadog ConnectorAgent — specialist agent with Datadog connector tools.
// See CLAUDE.md §Agents for specialist agent architecture.
import { createSpecialistAgent } from '@anvay/agent'
import type { SpecialistAgent, SpecialistAgentConfig } from '@anvay/agent'
import { DatadogConnector } from './connector.js'

export function createDatadogAgent(
  perimeter: SpecialistAgentConfig['perimeter'],
  auditSink: SpecialistAgentConfig['auditSink'],
  model: SpecialistAgentConfig['model'],
): SpecialistAgent {
  const connector = new DatadogConnector('datadog-prod', process.env['DATADOG_API_KEY'] ?? '', process.env['DATADOG_APP_KEY'] ?? '')
  return createSpecialistAgent({
    name: 'datadog',
    model,
    tools: [],
    systemPrompt: 'You are a Datadog monitoring specialist. Use get_metrics, search_logs, and list_monitors to investigate observability data.',
    perimeter,
    auditSink,
  })
}
