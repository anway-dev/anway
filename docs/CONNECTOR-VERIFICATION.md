# Connector Verification Record

Evidence tiers, strongest first:

| Tier | Meaning |
|------|---------|
| **live-instance** | Real bootstrap + real read tools executed against a real running service (`scripts/live-connector-verify.ts`) |
| **public-sandbox** | Same runner against a vendor-operated public instance |
| **contract (Prism)** | Requests validated against the vendor's official OpenAPI spec (testcontainer) |
| **docs-verified** | Endpoints/auth/pagination hand-checked against official vendor API docs (2026-07-10) |
| **fixture-only** | Fixture HTTP server tests — catches URL/parse bugs, cannot catch a misunderstood vendor API |

A connector may hold several tiers; the strongest is listed. Everything has
fixture/unit suites on top.

## Status (2026-07-10)

| Connector | Strongest evidence | Notes |
|-----------|-------------------|-------|
| prometheus | live-instance | Dev-stack instance; alert-investigation E2E flows |
| alertmanager | live-instance | Dev-stack; real webhook alert flow |
| loki | live-instance | Dev-stack |
| grafana | live-instance + public-sandbox | play.grafana.org (Grafana 13): bootstrap indexed 463 real entities; dashboards/datasources/alerts tools returned real data. **Bug found+fixed:** `/api/alerts` is legacy alerting, removed in Grafana 11 → unified-alerting Alertmanager API |
| k8s | live-instance | Real cluster (orbstack); scale/restart/cordon verified in prior sessions |
| argocd | live-instance | Real ArgoCD in cluster |
| github | live-instance + contract | Real signed webhook delivery + org-hook registration; Prism contract vs official spec |
| terraform (local) | live-instance | Real `terraform apply` via gateway routes |
| vault | live-instance | Real dev-mode container: 5 secret engines indexed, real KV metadata read. **Bug found+fixed:** `/v1/sys/mounts` envelope (`wrap_info: null`) crashed bootstrap |
| jenkins | public-sandbox + docs-verified | ci.jenkins.io: valid anonymous envelope. **Fix:** user/apiToken now optional pair (anonymous-read instances are real) |
| jira | contract | Prism vs official Atlassian OpenAPI |
| confluence | contract | Prism vs official Atlassian OpenAPI |
| pagerduty | contract | Prism vs official PagerDuty OpenAPI |
| slack | contract | Prism vs official Slack OpenAPI |
| snyk | docs-verified | **Migrated off vendor-deprecated v1 API** to GA REST (JSON:API, version param, links.next paging) |
| circleci | docs-verified | **Bugs found+fixed:** org-slug hardcoded to `gh/anway`; `/project/{org}` endpoint doesn't exist in v2 (Services now derived from pipeline `project_slug`) |
| linear | docs-verified | **Bug found+fixed:** personal API keys (`lin_api_*`) must be RAW in Authorization; Bearer is OAuth-only |
| coralogix | docs-verified | **Bugs found+fixed:** default host mixed legacy prefix + new region scheme; `get-applications` endpoint doesn't exist (→ DataPrime query); alert-definitions path → v3 REST `/mgmt/openapi/3/...` |
| datadog | docs-verified | v1 dashboard/monitor/query + v2 logs/services paths and DD-API-KEY/DD-APPLICATION-KEY headers match docs |
| opsgenie | docs-verified | `/v1/incidents`, `/v2/teams`, `/v2/schedules`, `GenieKey` auth match docs |
| newrelic | docs-verified | REST v2 `Api-Key` header matches docs; v2 still supported, NerdGraph is the long-term path |
| dynatrace | docs-verified | `/api/v2/*` + `Api-Token` auth match docs; nextPageKey paging correct |
| launchdarkly | docs-verified | `/api/v2/*` + raw-key Authorization match docs |
| notion | docs-verified | `/v1/search` + `Notion-Version` header present |
| vercel | docs-verified | v6/v9/v13 endpoints + Bearer auth match docs |
| sentry | docs-verified | `/api/0/*` + Bearer auth match docs |
| elastic | fixture-only¹ | Real-container run attempted; ES boot flaky under load — rerun pending |
| sonarqube | fixture-only¹ | Real-container run attempted; container OOM'd under load — rerun pending |
| aws-cloudwatch | live-instance (LocalStack, partial) | 2026-07-11 vs LocalStack 3.8 community: get_alarms returned the real seeded alarm, get_cloud_metrics returned a valid series, and the bootstrap's ec2 leg succeeded. **Bug found+fixed:** bootstrap ignored `endpointUrl` (agent honored it) — a LocalStack-configured connector's tools worked while bootstrap silently hit real AWS. Bootstrap's ecs leg needs LocalStack Pro or a real AWS account (community returns InternalFailure for ecs; the connector correctly aborts on non-auth errors). Note: `localstack/localstack:latest` now exits 55 demanding a license — pin a community tag (3.8) |
| aws-health | fixture-only | No LocalStack support for the Health API; needs real AWS account |
| ecs / eks / gke | fixture-only | Conformance + fixture suites; need real cloud accounts (EKS/GKE not in LocalStack community) |
| azure-monitor | fixture-only | az-CLI based; needs real Azure login (CI conformance covers no-auth path) |
| gcp-monitoring | fixture-only | gcloud-based; needs real GCP login |
| datadog/newrelic/opsgenie/… (SaaS) | — | Live tier requires real vendor accounts — blocked on credentials, not on code |

¹ self-hostable; live run attempted this session, blocked only by machine
load, not by connector code. Re-run with `scripts/live-connector-verify.ts`.

## How to run a live verification

```bash
# service in docker / sandbox URL / LocalStack
pnpm --filter anway-gateway exec tsx ../../scripts/live-connector-verify.ts \
  vault '{"baseUrl":"http://localhost:18200","token":"..."}' \
  get_secret_metadata '{"path":"secret/prod/payments-api"}'
```
