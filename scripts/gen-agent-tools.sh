#!/bin/bash
# Generate connector agent files for all connector packages
BASE="/Users/raj/workspace_code/ai-proj/restol/connectors"

declare -A TOOLS
# Format: connector:toolname:write:params:response_example

# Group 1 — Observability (datadog already has connector.ts, add agent.ts)
for id in datadog prometheus grafana newrelic coralogix dynatrace elastic; do
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  {
    definition: { name: 'get_metrics', description: 'Fetch metrics for a service', parameters: { type: 'object', properties: { service: { type: 'string' }, window: { type: 'string' }, metric: { type: 'string', optional: true } }, required: ['service', 'window'] } },
    execute: () => Promise.resolve({ points: Array.from({length:12},(_,i)=>({t:Date.now()-(11-i)*300_000,v:0.01+Math.random()*0.05})), unit: 'requests/s' }),
    write: false,
  },
  {
    definition: { name: 'get_alerts', description: 'List active alerts', parameters: { type: 'object', properties: { service: { type: 'string', optional: true }, severity: { type: 'string', optional: true } } } },
    execute: () => Promise.resolve({ alerts: [{ id:'al-1',title:'High error rate',severity:'critical',status:'firing',firedAt:new Date().toISOString() }] }),
    write: false,
  },
  {
    definition: { name: 'get_logs', description: 'Search logs for a service', parameters: { type: 'object', properties: { service: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['service', 'query'] } },
    execute: () => Promise.resolve({ lines: [{ ts: new Date().toISOString(), level: 'error', msg: 'Sample log line' }] }),
    write: false,
  },
]

export class ${id^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Group 2 — incidents (pagerduty, opsgenie)
for id in pagerduty opsgenie; do
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_active_incidents', description: 'List active incidents', parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } } }, execute: () => Promise.resolve({ incidents: [{ id:'inc-1',title:'Payment failures',severity:'critical',startedAt:new Date().toISOString(),status:'triggered' }] }), write: false },
  { definition: { name: 'get_oncall', description: 'Get oncall engineer', parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] } }, execute: () => Promise.resolve({ engineer: { name:'Alice',email:'alice@acme.dev',phone:'+1-555-0100' } }), write: false },
  { definition: { name: 'create_incident', description: 'Create a new incident', parameters: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string' }, serviceId: { type: 'string' } }, required: ['title', 'severity'] } }, execute: () => Promise.resolve({ id: 'inc-new' }), write: true },
  { definition: { name: 'acknowledge_alert', description: 'Acknowledge an alert', parameters: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] } }, execute: () => Promise.resolve({ ok: true }), write: true },
]

export class ${id^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Group 3 — CI/CD (jenkins, circleci, argocd, vercel)
for id in jenkins circleci argocd vercel; do
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pipelines', description: 'List pipelines', parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } }, execute: () => Promise.resolve({ pipelines: [{ id:'pl-1',name:'Deploy',status:'passed',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_builds', description: 'List builds', parameters: { type: 'object', properties: { pipeline: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['pipeline'] } }, execute: () => Promise.resolve({ builds: [{ id:'b-1',sha:'abc123',status:'success',duration:120,startedAt:new Date().toISOString() }] }), write: false },
  { definition: { name: 'trigger_deploy', description: 'Trigger a deploy', parameters: { type: 'object', properties: { service: { type: 'string' }, env: { type: 'string' }, sha: { type: 'string' } }, required: ['service', 'env', 'sha'] } }, execute: () => Promise.resolve({ runId: 'run-1' }), write: true },
]

export class ${id^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Group 4 — Issues (linear, jira)
for id in linear jira; do
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_issues', description: 'List issues', parameters: { type: 'object', properties: { project: { type: 'string' }, state: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }, required: ['project'] } }, execute: () => Promise.resolve({ issues: [{ id:'i-1',title:'Fix checkout bug',status:'open',assignee:'bob',priority:'high' }] }), write: false },
  { definition: { name: 'get_issue', description: 'Get issue details', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }, execute: () => Promise.resolve({ issue: { id:'i-1',title:'Fix checkout bug',description:'...',status:'open' } }), write: false },
  { definition: { name: 'create_issue', description: 'Create an issue', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string', optional: true }, labels: { type: 'array', items: { type: 'string' }, optional: true } }, required: ['title'] } }, execute: () => Promise.resolve({ id: 'i-new' }), write: true },
  { definition: { name: 'update_issue', description: 'Update issue status', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } }, required: ['id', 'status'] } }, execute: () => Promise.resolve({ ok: true }), write: true },
]

export class ${id^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Group 5 — Code (github)
cat > "$BASE/github/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_prs', description: 'List pull requests', parameters: { type: 'object', properties: { repo: { type: 'string' }, state: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }, required: ['repo'] } }, execute: () => Promise.resolve({ prs: [{ id:1,title:'Fix bug',state:'open',author:'alice',mergedAt:null,sha:'abc123' }] }), write: false },
  { definition: { name: 'get_commits', description: 'List commits', parameters: { type: 'object', properties: { repo: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['repo'] } }, execute: () => Promise.resolve({ commits: [{ sha:'abc123',message:'fix: bug',author:'alice',date:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_file', description: 'Get file content', parameters: { type: 'object', properties: { repo: { type: 'string' }, path: { type: 'string' }, ref: { type: 'string', optional: true } }, required: ['repo', 'path'] } }, execute: () => Promise.resolve({ content: '// file content' }), write: false },
  { definition: { name: 'create_pr', description: 'Create a pull request', parameters: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' } }, required: ['repo', 'title', 'base', 'head'] } }, execute: () => Promise.resolve({ url: 'https://github.com/org/repo/pull/1' }), write: true },
]

export class GithubAgent implements IConnectorAgent {
  readonly connectorType = 'github'
  readonly tools = TOOLS
}
AGENT

# Group 6 — K8s (k8s)
cat > "$BASE/k8s/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_pods', description: 'List pods', parameters: { type: 'object', properties: { namespace: { type: 'string' }, selector: { type: 'string', optional: true } }, required: ['namespace'] } }, execute: () => Promise.resolve({ pods: [{ name:'payments-api-7d9f6',status:'Running',restarts:0,node:'node-3' }] }), write: false },
  { definition: { name: 'get_deployments', description: 'List deployments', parameters: { type: 'object', properties: { namespace: { type: 'string' } }, required: ['namespace'] } }, execute: () => Promise.resolve({ deployments: [{ name:'payments-api',ready:3,desired:3,image:'payments-api:v2.3' }] }), write: false },
  { definition: { name: 'get_pod_logs', description: 'Get pod logs', parameters: { type: 'object', properties: { namespace: { type: 'string' }, pod: { type: 'string' }, lines: { type: 'number', optional: true } }, required: ['namespace', 'pod'] } }, execute: () => Promise.resolve({ logs: ['[INFO] Server started'] }), write: false },
  { definition: { name: 'get_events', description: 'List namespace events', parameters: { type: 'object', properties: { namespace: { type: 'string' } }, required: ['namespace'] } }, execute: () => Promise.resolve({ events: [{ reason:'BackOff',object:'pod/payments-api',message:'Back-off restarting',ts:new Date().toISOString() }] }), write: false },
  { definition: { name: 'restart_deployment', description: 'Restart a deployment', parameters: { type: 'object', properties: { namespace: { type: 'string' }, deployment: { type: 'string' } }, required: ['namespace', 'deployment'] } }, execute: () => Promise.resolve({ ok: true }), write: true },
]

export class K8sAgent implements IConnectorAgent {
  readonly connectorType = 'k8s'
  readonly tools = TOOLS
}
AGENT

# Group 7 — Cloud (aws-cloudwatch, aws-health, gcp-monitoring, azure-monitor)
for id in aws-cloudwatch aws-health gcp-monitoring azure-monitor; do
  SAFE="${id//-/_}"
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_metrics', description: 'Fetch cloud metrics', parameters: { type: 'object', properties: { resource: { type: 'string' }, metric: { type: 'string' }, window: { type: 'string' } }, required: ['resource', 'metric', 'window'] } }, execute: () => Promise.resolve({ points: [{ t: Date.now(), v: 0.5 }] }), write: false },
  { definition: { name: 'get_alarms', description: 'List alarms', parameters: { type: 'object', properties: { service: { type: 'string', optional: true } } } }, execute: () => Promise.resolve({ alarms: [{ id:'al-1',name:'High CPU',state:'ALARM',reason:'CPU > 90%' }] }), write: false },
  { definition: { name: 'get_health_events', description: 'Get service health events', parameters: { type: 'object', properties: {} } }, execute: () => Promise.resolve({ events: [{ service:'EC2',region:'us-east-1',status:'RESOLVED',message:'Network issue resolved' }] }), write: false },
]

export class ${SAFE^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Group 8 — Infrastructure (terraform, vault)
for id in terraform vault; do
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_workspaces', description: 'List workspaces', parameters: { type: 'object', properties: {} } }, execute: () => Promise.resolve({ workspaces: [{ name:'prod',status:'healthy',lastRun:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_run', description: 'Get workspace run details', parameters: { type: 'object', properties: { workspaceId: { type: 'string' } }, required: ['workspaceId'] } }, execute: () => Promise.resolve({ run: { id:'r-1',status:'applied',message:'Deploy v2.3',appliedAt:new Date().toISOString() } }), write: false },
]

export class ${id^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Group 9 — Collaboration (slack, notion, confluence)
for id in slack notion confluence; do
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'post_message', description: 'Post a message', parameters: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } }, execute: () => Promise.resolve({ ts: '1234567890.123' }), write: true },
  { definition: { name: 'search_pages', description: 'Search pages', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }, execute: () => Promise.resolve({ pages: [{ id:'p-1',title:'Runbook',url:'https://...',updatedAt:new Date().toISOString() }] }), write: false },
]

export class ${id^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Group 10 — Security & Quality (snyk, sonarqube, launchdarkly, sentry)
for id in snyk sonarqube launchdarkly sentry; do
cat > "$BASE/$id/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_issues', description: 'List issues/vulnerabilities', parameters: { type: 'object', properties: { project: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['project'] } }, execute: () => Promise.resolve({ issues: [{ id:'v-1',severity:'high',title:'XSS vulnerability',message:'',file:'app.js',line:42 }] }), write: false },
]

export class ${id^}Agent implements IConnectorAgent {
  readonly connectorType = '$id'
  readonly tools = TOOLS
}
AGENT
done

# Also do missing stubs: loki, prometheus already done in group 1
# Add eks, gke stubs as k8s aliases
for id in eks gke; do
cp "$BASE/k8s/src/agent.ts" "$BASE/$id/src/agent.ts" 2>/dev/null
done

# Add vault-specific extra tool
cat > "$BASE/vault/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_secret_metadata', description: 'List secret keys at a path', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, execute: () => Promise.resolve({ keys: ['api-key','db-password'], lastUpdated: new Date().toISOString() }), write: false },
  { definition: { name: 'list_policies', description: 'List Vault policies', parameters: { type: 'object', properties: {} } }, execute: () => Promise.resolve({ policies: ['admin','readonly'] }), write: false },
]

export class VaultAgent implements IConnectorAgent {
  readonly connectorType = 'vault'
  readonly tools = TOOLS
}
AGENT

# Add launchdarkly with flag-specific tools
cat > "$BASE/launchdarkly/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_flags', description: 'List feature flags', parameters: { type: 'object', properties: { project: { type: 'string' }, env: { type: 'string' } }, required: ['project', 'env'] } }, execute: () => Promise.resolve({ flags: [{ key:'new-checkout',name:'New Checkout',enabled:true,targeting:true }] }), write: false },
  { definition: { name: 'toggle_flag', description: 'Toggle a feature flag', parameters: { type: 'object', properties: { flagKey: { type: 'string' }, env: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['flagKey', 'env', 'enabled'] } }, execute: () => Promise.resolve({ ok: true }), write: true },
]

export class LaunchdarklyAgent implements IConnectorAgent {
  readonly connectorType = 'launchdarkly'
  readonly tools = TOOLS
}
AGENT

# Add sentry with extra event tool
cat > "$BASE/sentry/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_issues', description: 'List Sentry issues', parameters: { type: 'object', properties: { project: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['project'] } }, execute: () => Promise.resolve({ issues: [{ id:'s-1',title:'TypeError: undefined',count:42,firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString() }] }), write: false },
  { definition: { name: 'get_events', description: 'Get events for an issue', parameters: { type: 'object', properties: { issueId: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['issueId'] } }, execute: () => Promise.resolve({ events: [{ id:'e-1',message:'TypeError',stack:'at line 42',ts:new Date().toISOString() }] }), write: false },
]

export class SentryAgent implements IConnectorAgent {
  readonly connectorType = 'sentry'
  readonly tools = TOOLS
}
AGENT

# Add sonarqube with metric tool
cat > "$BASE/sonarqube/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_issues', description: 'List code quality issues', parameters: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } }, execute: () => Promise.resolve({ issues: [{ severity:'critical',type:'BUG',message:'Null pointer',file:'App.java',line:42 }] }), write: false },
  { definition: { name: 'get_quality_metrics', description: 'Get quality metrics', parameters: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } }, execute: () => Promise.resolve({ coverage: 85.3, duplication: 3.1, bugs: 12, vulnerabilities: 0 }), write: false },
]

export class SonarqubeAgent implements IConnectorAgent {
  readonly connectorType = 'sonarqube'
  readonly tools = TOOLS
}
AGENT

# Add slack with separate channel tool
cat > "$BASE/slack/src/agent.ts" << AGENT
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'

const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_channel_history', description: 'Get channel messages', parameters: { type: 'object', properties: { channel: { type: 'string' }, limit: { type: 'number', optional: true } }, required: ['channel'] } }, execute: () => Promise.resolve({ messages: [{ user:'U123',text:'Deploy complete',ts:'1234567890.123' }] }), write: false },
  { definition: { name: 'post_message', description: 'Post a message to channel', parameters: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } }, execute: () => Promise.resolve({ ts: '1234567890.456' }), write: true },
]

export class SlackAgent implements IConnectorAgent {
  readonly connectorType = 'slack'
  readonly tools = TOOLS
}
AGENT

echo "All connector agents generated."
