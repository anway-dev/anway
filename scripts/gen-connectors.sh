#!/bin/bash
# Generate 23 connector stub packages
CONNECTORS=(
  "slack:Slack"
  "grafana:Grafana"
  "elastic:Elasticsearch"
  "dynatrace:Dynatrace"
  "sentry:Sentry"
  "jenkins:Jenkins"
  "circleci:CircleCI"
  "vercel:Vercel"
  "k8s:Kubernetes"
  "vault:Vault"
  "snyk:Snyk"
  "sonarqube:SonarQube"
  "opsgenie:OpsGenie"
  "launchdarkly:LaunchDarkly"
  "confluence:Confluence"
  "prometheus:Prometheus"
  "newrelic:NewRelic"
  "jira:Jira"
  "loki:Loki"
  "terraform:Terraform"
  "pagerduty:PagerDuty"
  "coralogix:Coralogix"
  "notion:Notion"
)

BASE="/Users/raj/workspace_code/ai-proj/restol/connectors"
TS_CONFIG='{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "skipLibCheck": true
  },
  "include": ["src"]
}'

for entry in "${CONNECTORS[@]}"; do
  ID="${entry%%:*}"
  NAME="${entry##*:}"
  DIR="$BASE/$ID"
  CLASS="${NAME}Bootstrap"

  [ -d "$DIR" ] && echo "SKIP $ID (exists)" && continue

  mkdir -p "$DIR/src/__tests__"
  echo "CREATE $ID"

  # package.json
  cat > "$DIR/package.json" <<EOF
{
  "name": "@anway/connector-$ID",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@anway/agent": "workspace:*",
    "@anway/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
EOF

  # tsconfig.json
  echo "$TS_CONFIG" > "$DIR/tsconfig.json"

  # src/bootstrap.ts
  cat > "$DIR/src/bootstrap.ts" <<EOF
import type { IConnectorBootstrap, ConnectorBootstrapResult } from '@anway/agent'
import type { IKnowledgeGraph } from '@anway/agent'
import type { TenantId } from '@anway/types'

export class $CLASS implements IConnectorBootstrap {
  constructor(private readonly kg: IKnowledgeGraph) {}

  async bootstrap(_tenantId: TenantId, _connectorId: string, _payload: Record<string, unknown>): Promise<ConnectorBootstrapResult> {
    return { entitiesUpserted: 0, relationshipsUpserted: 0, episodeHints: ['$NAME bootstrap: connector credentials not yet configured'] }
  }
}
EOF

  # src/index.ts
  cat > "$DIR/src/index.ts" <<EOF
export { $CLASS } from './bootstrap.js'
EOF

  # src/__tests__/bootstrap.test.ts
  cat > "$DIR/src/__tests__/bootstrap.test.ts" <<EOF
import { describe, it, expect } from 'vitest'

describe('${NAME}Bootstrap', () => {
  it('exports class', async () => {
    const mod = await import('../bootstrap.js')
    expect(mod.${CLASS}).toBeDefined()
  })
})
EOF

done

echo "DONE: $(ls -d "$BASE"/*/ | wc -l | tr -d ' ') connector packages"
