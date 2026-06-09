import type {{ IConnectorAgent, ConnectorTool }} from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  {{ definition: {{ name: 'get_issues', description: 'List code quality issues', parameters: {{ type: 'object', properties: {{ project: {{ type: 'string' }} }}, required: ['project'] }} }}, execute: () => Promise.resolve({{ issues: [{{ severity:'critical',type:'BUG',message:'Null pointer',file:'App.java',line:42 }}] }}), write: false }},
  {{ definition: {{ name: 'get_quality_metrics', description: 'Get quality metrics', parameters: {{ type: 'object', properties: {{ project: {{ type: 'string' }} }}, required: ['project'] }} }}, execute: () => Promise.resolve({{ coverage: 85.3, duplication: 3.1, bugs: 12, vulnerabilities: 0 }}), write: false }},
]

export class SonarqubeAgent implements IConnectorAgent {{
  readonly connectorType = 'sonarqube'
  readonly tools = TOOLS
}}
