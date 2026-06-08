// Datadog ConnectorAgent — specialist agent with Datadog connector tools.
import { createSpecialistAgent } from '@anvay/agent'
import type { SpecialistAgent, SpecialistAgentConfig } from '@anvay/agent'
import { DatadogConnector } from './connector.js'
import { makeDatadogTools } from './tools.js'

export function createDatadogAgent(
  perimeter: SpecialistAgentConfig['perimeter'],
  auditSink: SpecialistAgentConfig['auditSink'],
  model: SpecialistAgentConfig['model'],
): SpecialistAgent {
  const connector = new DatadogConnector('datadog-prod', process.env['DATADOG_API_KEY'] ?? '', process.env['DATADOG_APP_KEY'] ?? '')
  return createSpecialistAgent({
    name: 'datadog',
    model,
    tools: makeDatadogTools(connector),
    systemPrompt: 'You are a Datadog monitoring specialist. Use get_metrics, search_logs, and list_monitors to investigate observability data.',
    perimeter,
    auditSink,
  })
}
