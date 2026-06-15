import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const log = (msg: string) => process.stdout.write(`[seed] ${msg}\n`)

// Fixed UUID for deterministic E2E test access
const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001'

async function main() {
  log('Starting seed...')

  await prisma.$executeRaw`
    INSERT INTO tenants (id, name, slug, plan, token_budget_monthly, connector_limit)
    VALUES (${DEMO_TENANT_ID}::uuid, 'Acme Corp (Demo)', 'demo', 'tier2', 10000000, 10)
    ON CONFLICT (slug) DO NOTHING
  `
  const tenant = { id: DEMO_TENANT_ID, slug: 'demo' }
  log(`Tenant: ${tenant.slug} (${tenant.id})`)

  const user = await prisma.user.upsert({
    where: {
      tenant_id_email: {
        tenant_id: tenant.id,
        email: 'admin@demo.anvay.dev',
      },
    },
    update: {},
    create: {
      tenant_id: tenant.id,
      email: 'admin@demo.anvay.dev',
      role: 'admin',
    },
  })
  log(`User: ${user.email} (role=${user.role})`)

  await prisma.$executeRaw`
    INSERT INTO sessions (id, user_id, tenant_id, created_at, expires_at, updated_at, turn_count)
    VALUES (gen_random_uuid(), ${user.id}::uuid, ${tenant.id}::uuid, now(), now() + interval '24 hours', now(), 0)
    ON CONFLICT DO NOTHING
  `
  log('Session seeded.')

  // Seed connectors with correct nested capability_manifest format
  await prisma.connector.createMany({
    skipDuplicates: true,
    data: [
      { tenant_id: tenant.id, name: 'GitHub (Demo)', type: 'cli', mode: 'read', config_enc: JSON.stringify({ binary: 'gh', allowedSubcommands: ['pr list', 'issue list', 'run list'] }), capability_manifest: { capabilities: { read: ['org/*'], write: [] } } },
      { tenant_id: tenant.id, name: 'PagerDuty (Demo)', type: 'cli', mode: 'read', config_enc: JSON.stringify({ binary: 'pd', allowedSubcommands: ['incident list', 'incident view'] }), capability_manifest: { capabilities: { read: ['*'], write: [] } } },
      { tenant_id: tenant.id, name: 'ArgoCD (Demo)', type: 'cli', mode: 'read', config_enc: JSON.stringify({ binary: 'argocd', allowedSubcommands: ['app list', 'app get'] }), capability_manifest: { capabilities: { read: ['*'], write: [] } } },
    ],
  })
  log('Connectors seeded.')

  // ── 1. Environments ──────────────────────────────────────────────────────────
  await prisma.$executeRaw`
    INSERT INTO environments (id, tenant_id, name, label, color, sort_order)
    VALUES
      ('00000000-0000-0000-0001-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid, 'staging', 'Staging', '#3b82f6', 0),
      ('00000000-0000-0000-0001-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid, 'preprod', 'Pre-production', '#f59e0b', 1),
      ('00000000-0000-0000-0001-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid, 'prod', 'Production', '#10b981', 2)
    ON CONFLICT DO NOTHING
  `
  log('Environments seeded.')

  // ── 2. KB entities: 22 Services ─────────────────────────────────────────────
  await prisma.$executeRaw`
    INSERT INTO entities (tenant_id, type, name, metadata)
    VALUES
      (${DEMO_TENANT_ID}::uuid, 'Service', 'payments-api',          '{"language":"TypeScript","tier":"critical","team":"payments-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'auth-service',          '{"language":"Go","tier":"critical","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'checkout-service',      '{"language":"TypeScript","tier":"critical","team":"payments-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'order-service',         '{"language":"Java","tier":"high","team":"payments-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'inventory-service',     '{"language":"Go","tier":"high","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'notification-service',  '{"language":"TypeScript","tier":"medium","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'recommendation-engine', '{"language":"Python","tier":"high","team":"data-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'search-service',        '{"language":"Go","tier":"high","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'analytics-pipeline',    '{"language":"Python","tier":"medium","team":"data-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'fraud-detection',       '{"language":"Python","tier":"critical","team":"payments-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'shipping-service',      '{"language":"Go","tier":"medium","team":"payments-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'catalog-service',       '{"language":"TypeScript","tier":"medium","team":"payments-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'pricing-service',       '{"language":"Go","tier":"high","team":"payments-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'user-service',          '{"language":"Go","tier":"critical","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'email-service',         '{"language":"TypeScript","tier":"low","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'sms-service',           '{"language":"TypeScript","tier":"medium","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'cdn-service',           '{"language":"Go","tier":"high","team":"infra-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'api-gateway',           '{"language":"Go","tier":"critical","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'webhook-service',       '{"language":"TypeScript","tier":"medium","team":"platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'ml-training-service',   '{"language":"Python","tier":"low","team":"data-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'data-warehouse',        '{"language":"Python","tier":"medium","team":"data-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Service', 'reporting-service',     '{"language":"TypeScript","tier":"medium","team":"data-team"}'::jsonb)
    ON CONFLICT (tenant_id, type, name) DO NOTHING
  `
  log('22 Service entities seeded.')

  // ── 3. KB entities: 5 Namespaces ────────────────────────────────────────────
  await prisma.$executeRaw`
    INSERT INTO entities (tenant_id, type, name, metadata)
    VALUES
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'payments',  '{"cluster":"prod-us-east","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'orders',    '{"cluster":"prod-us-east","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'platform',  '{"cluster":"prod-us-east","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'ml',        '{"cluster":"prod-us-west","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'data',      '{"cluster":"prod-us-east","env":"prod"}'::jsonb)
    ON CONFLICT (tenant_id, type, name) DO NOTHING
  `
  log('5 Namespace entities seeded.')

  // ── 4. KB entities: 4 Teams (+ preserve existing 'platform') ────────────────
  await prisma.$executeRaw`
    INSERT INTO entities (tenant_id, type, name, metadata)
    VALUES
      (${DEMO_TENANT_ID}::uuid, 'Team', 'platform-sre',   '{"slack":"#platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'payments-team',  '{"slack":"#payments"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'data-team',      '{"slack":"#data"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'infra-team',     '{"slack":"#infra"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'platform',       '{"slack":"#platform"}'::jsonb)
    ON CONFLICT (tenant_id, type, name) DO NOTHING
  `
  log('5 Team entities seeded.')

  // ── 5. Incidents ─────────────────────────────────────────────────────────────
  await prisma.incident.createMany({
    skipDuplicates: true,
    data: [
      // Active — critical
      {
        id: '10000000-0000-0000-0000-000000000001',
        tenant_id: tenant.id,
        title: 'payments-api error rate spike: 12% errors in prod',
        severity: 'critical',
        status: 'active',
        description: 'Error rate on payments-api crossed 10% threshold at 14:32 UTC. Checkout failures reported by multiple users. P99 latency also elevated at 2.8s.',
        suggested_root_cause: 'Likely related to v2.3.1 deploy 14 minutes ago — billing-logic refactor introduced unhandled edge case for international cards.',
        created_at: new Date(Date.now() - 25 * 60 * 1000),
      },
      // Active — high
      {
        id: '10000000-0000-0000-0000-000000000002',
        tenant_id: tenant.id,
        title: 'auth-service elevated latency: P99 at 4.1s',
        severity: 'high',
        status: 'active',
        description: 'auth-service P99 latency crossed 4s SLO threshold. Token validation endpoint most affected. No errors, but user-visible slowness on login flows.',
        suggested_root_cause: 'Redis connection pool exhaustion suspected — recent session spike from marketing campaign.',
        created_at: new Date(Date.now() - 10 * 60 * 1000),
      },
      // Active — medium
      {
        id: '10000000-0000-0000-0000-000000000003',
        tenant_id: tenant.id,
        title: 'notification-service: email delivery delay > 8 min',
        severity: 'medium',
        status: 'active',
        description: 'Email delivery queue backed up. Average delay 8.4 minutes vs SLO of 2 minutes. SMS unaffected.',
        suggested_root_cause: 'SES rate limit hit — high order volume from flash sale driving notification burst.',
        created_at: new Date(Date.now() - 45 * 60 * 1000),
      },
      // Investigating — critical
      {
        id: '10000000-0000-0000-0000-000000000004',
        tenant_id: tenant.id,
        title: 'fraud-detection: model serving degraded — 60% latency increase',
        severity: 'critical',
        status: 'investigating',
        description: 'fraud-detection model inference latency spiked from 45ms to 110ms. Risk scoring running slow — checkout flows timing out waiting for fraud score.',
        suggested_root_cause: 'GPU node rescheduled after spot instance preemption. Model loaded on fallback CPU node.',
        created_at: new Date(Date.now() - 90 * 60 * 1000),
      },
      // Investigating — high
      {
        id: '10000000-0000-0000-0000-000000000005',
        tenant_id: tenant.id,
        title: 'data-warehouse: nightly ETL job failing on orders table',
        severity: 'high',
        status: 'investigating',
        description: "Nightly ETL job for orders table failed at 02:14 UTC. Downstream reports stale. Analytics dashboards showing yesterday's data.",
        suggested_root_cause: 'Schema drift: order-service added nullable column order_metadata last week without migrating warehouse schema.',
        created_at: new Date(Date.now() - 4 * 60 * 60 * 1000),
      },
      // Resolved — high
      {
        id: '10000000-0000-0000-0000-000000000006',
        tenant_id: tenant.id,
        title: 'search-service: index rebuild caused 3-minute outage',
        severity: 'high',
        status: 'resolved',
        description: 'search-service full index rebuild triggered during peak traffic window. Write lock caused 3-minute complete outage on product search.',
        suggested_root_cause: 'Index rebuild cron job was not respecting traffic-based backoff window. Fixed by adding peak-hours lock.',
        created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        resolved_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 1000),
      },
      // Resolved — medium
      {
        id: '10000000-0000-0000-0000-000000000007',
        tenant_id: tenant.id,
        title: 'inventory-service: stock count drift on 3 SKUs',
        severity: 'medium',
        status: 'resolved',
        description: 'Stock counts for 3 high-velocity SKUs drifted from warehouse truth by up to 200 units. Oversell risk detected before customer impact.',
        suggested_root_cause: 'Race condition in optimistic locking during concurrent cart checkouts. Mutex added to stock reservation path.',
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        resolved_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 47 * 60 * 1000),
      },
      // Resolved — high
      {
        id: '10000000-0000-0000-0000-000000000008',
        tenant_id: tenant.id,
        title: 'api-gateway: cert renewal failed — TLS handshake errors in EU region',
        severity: 'high',
        status: 'resolved',
        description: "TLS certificate for eu-west-1 endpoint expired. All HTTPS traffic to EU customers returned SSL handshake errors for ~8 minutes.",
        suggested_root_cause: "cert-manager failed to renew cert due to Let's Encrypt rate limit hit during previous failed rotation attempt.",
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        resolved_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 8 * 60 * 1000),
      },
      // Resolved — low
      {
        id: '10000000-0000-0000-0000-000000000009',
        tenant_id: tenant.id,
        title: 'reporting-service: daily PDF export slow (>60s)',
        severity: 'low',
        status: 'resolved',
        description: 'Large tenant PDF exports timing out at 60s cutoff. Exports > 50k rows failed silently. Users saw empty downloads.',
        suggested_root_cause: 'Missing pagination on DB query for large datasets. Fixed with server-side cursor pagination.',
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        resolved_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      },
      // Resolved — medium
      {
        id: '10000000-0000-0000-0000-000000000010',
        tenant_id: tenant.id,
        title: 'cdn-service: cache purge loop causing repeated origin stampede',
        severity: 'medium',
        status: 'resolved',
        description: 'Cache invalidation bug caused CDN nodes to simultaneously purge and re-fetch popular product images. Origin bandwidth spiked 8x for 12 minutes.',
        suggested_root_cause: 'Cache-control header missing max-stale directive. Cache purge triggered by every node independently instead of coordinated sweep.',
        created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        resolved_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000 + 12 * 60 * 1000),
      },
    ],
  })
  log('10 Incidents seeded.')

  // ── 6. Pipelines + Stage Runs ────────────────────────────────────────────────
  await prisma.$executeRaw`
    INSERT INTO pipelines (id, tenant_id, name, description, stages, status, metadata)
    VALUES
      (
        '20000000-0000-0000-0000-000000000001'::uuid,
        ${DEMO_TENANT_ID}::uuid,
        'payments-api-deploy',
        'CI/CD pipeline for payments-api service',
        '[{"id":"build","name":"Build & Test"},{"id":"security-scan","name":"Security Scan"},{"id":"deploy-staging","name":"Deploy to Staging"},{"id":"integration-tests","name":"Integration Tests"},{"id":"deploy-prod","name":"Deploy to Production"}]'::jsonb,
        'running',
        '{"service":"payments-api","triggered_by":"pr_merged","sha":"a4f21bc9"}'::jsonb
      ),
      (
        '20000000-0000-0000-0000-000000000002'::uuid,
        ${DEMO_TENANT_ID}::uuid,
        'auth-service-deploy',
        'CI/CD pipeline for auth-service',
        '[{"id":"build","name":"Build & Test"},{"id":"security-scan","name":"Security Scan"},{"id":"deploy-staging","name":"Deploy to Staging"},{"id":"integration-tests","name":"Integration Tests"},{"id":"deploy-prod","name":"Deploy to Production"}]'::jsonb,
        'success',
        '{"service":"auth-service","triggered_by":"pr_merged","sha":"c8b3d44f"}'::jsonb
      ),
      (
        '20000000-0000-0000-0000-000000000003'::uuid,
        ${DEMO_TENANT_ID}::uuid,
        'platform-release',
        'Weekly platform release train',
        '[{"id":"changelog","name":"Changelog Generation"},{"id":"build-all","name":"Build All Services"},{"id":"smoke-tests","name":"Smoke Tests"},{"id":"canary-prod","name":"Canary Deploy"},{"id":"full-prod","name":"Full Production Rollout"}]'::jsonb,
        'failed',
        '{"version":"v1.14.0","triggered_by":"schedule","release_train":"weekly"}'::jsonb
      ),
      (
        '40000000-0000-0000-0000-000000000001'::uuid,
        ${DEMO_TENANT_ID}::uuid,
        'anvay-self-deploy',
        'Anvay deploys itself — no external CI',
        '[{"id":"build","label":"Build Images","type":"build"},{"id":"test","label":"Type Check + CI","type":"test"},{"id":"gate-staging","label":"Staging Gate","type":"gate"},{"id":"deploy-staging","label":"Deploy Staging","type":"deploy"},{"id":"monitor","label":"Monitor 10min","type":"monitor"},{"id":"gate-prod","label":"Production Gate","type":"gate"},{"id":"deploy-prod","label":"Deploy Production","type":"deploy"}]'::jsonb,
        'running',
        '{"sha":"a4f21bc9","triggered_by":"pr_merged","service":"anvay"}'::jsonb
      )
    ON CONFLICT DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO pipelines (id, tenant_id, name, description, stages, status, metadata)
    VALUES
      (
        '20000000-0000-0000-0000-000000000005'::uuid,
        ${DEMO_TENANT_ID}::uuid,
        'checkout-service-deploy',
        'CI/CD pipeline for checkout-service',
        '[{"id":"build","name":"Build & Test"},{"id":"security-scan","name":"Security Scan"},{"id":"deploy-staging","name":"Deploy to Staging"},{"id":"integration-tests","name":"Integration Tests"},{"id":"deploy-prod","name":"Deploy to Production"}]'::jsonb,
        'idle',
        '{"service":"checkout-service","triggered_by":"manual"}'::jsonb
      )
    ON CONFLICT DO NOTHING
  `
  log('5 Pipelines seeded.')

  // Stage runs for payments-api-deploy (running — mid-flight)
  await prisma.$executeRaw`
    INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at, finished_at)
    VALUES
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'build', 'success',
       '{"duration_ms":42300,"tests_passed":847,"tests_failed":0}'::jsonb,
       now() - interval '18 minutes', now() - interval '11 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'security-scan', 'success',
       '{"vulnerabilities":0,"advisories":2,"scan_tool":"trivy"}'::jsonb,
       now() - interval '11 minutes', now() - interval '8 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'deploy-staging', 'success',
       '{"pods_updated":3,"rollout_duration_ms":38000}'::jsonb,
       now() - interval '8 minutes', now() - interval '3 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'integration-tests', 'running',
       '{}'::jsonb,
       now() - interval '3 minutes', NULL),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'deploy-prod', 'pending',
       '{}'::jsonb,
       NULL, NULL)
  `

  // Stage runs for auth-service-deploy (all success)
  await prisma.$executeRaw`
    INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at, finished_at)
    VALUES
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid,
       'build', 'success',
       '{"duration_ms":31200,"tests_passed":612,"tests_failed":0}'::jsonb,
       now() - interval '3 hours', now() - interval '3 hours' + interval '8 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid,
       'security-scan', 'success',
       '{"vulnerabilities":0,"advisories":0,"scan_tool":"trivy"}'::jsonb,
       now() - interval '3 hours' + interval '8 minutes', now() - interval '3 hours' + interval '11 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid,
       'deploy-staging', 'success',
       '{"pods_updated":2,"rollout_duration_ms":22000}'::jsonb,
       now() - interval '3 hours' + interval '11 minutes', now() - interval '3 hours' + interval '18 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid,
       'integration-tests', 'success',
       '{"tests_passed":94,"tests_failed":0,"duration_ms":180000}'::jsonb,
       now() - interval '3 hours' + interval '18 minutes', now() - interval '3 hours' + interval '21 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid,
       'deploy-prod', 'success',
       '{"pods_updated":4,"rollout_duration_ms":55000,"canary_traffic_pct":100}'::jsonb,
       now() - interval '3 hours' + interval '21 minutes', now() - interval '3 hours' + interval '30 minutes')
  `

  // Stage runs for platform-release (failed at canary-prod)
  await prisma.$executeRaw`
    INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at, finished_at)
    VALUES
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid,
       'changelog', 'success',
       '{"entries":14,"breaking_changes":0}'::jsonb,
       now() - interval '6 hours', now() - interval '6 hours' + interval '2 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid,
       'build-all', 'success',
       '{"services_built":8,"duration_ms":284000}'::jsonb,
       now() - interval '6 hours' + interval '2 minutes', now() - interval '6 hours' + interval '49 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid,
       'smoke-tests', 'success',
       '{"tests_passed":42,"tests_failed":0}'::jsonb,
       now() - interval '6 hours' + interval '49 minutes', now() - interval '6 hours' + interval '53 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid,
       'canary-prod', 'failed',
       '{"error":"canary error rate 8.2% exceeded threshold 2%","canary_traffic_pct":5,"rolled_back":true}'::jsonb,
       now() - interval '6 hours' + interval '53 minutes', now() - interval '6 hours' + interval '61 minutes'),
      (gen_random_uuid(), '20000000-0000-0000-0000-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid,
       'full-prod', 'pending',
       '{}'::jsonb,
       NULL, NULL)
  `
  log('Pipeline stage runs seeded.')

  // Stage runs for anvay-self-deploy (running — build complete, test in progress)
  await prisma.$executeRaw`
    INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at, finished_at)
    VALUES
      (gen_random_uuid(), '40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'build', 'success',
       '{"duration_ms":62000,"images":["anvay-gateway","anvay-web","anvay-agent-service"]}'::jsonb,
       now() - interval '28 minutes', now() - interval '19 minutes'),
      (gen_random_uuid(), '40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'test', 'running',
       '{"tsc":"pass","packages":14,"gateway_tests":{"passed":62,"failed":0},"agent_tests":{"passed":93,"failed":0}}'::jsonb,
       now() - interval '19 minutes', NULL),
      (gen_random_uuid(), '40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'gate-staging', 'pending',
       '{}'::jsonb,
       NULL, NULL),
      (gen_random_uuid(), '40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'deploy-staging', 'pending',
       '{}'::jsonb,
       NULL, NULL),
      (gen_random_uuid(), '40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'monitor', 'pending',
       '{}'::jsonb,
       NULL, NULL),
      (gen_random_uuid(), '40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'gate-prod', 'pending',
       '{}'::jsonb,
       NULL, NULL),
      (gen_random_uuid(), '40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'deploy-prod', 'pending',
       '{}'::jsonb,
       NULL, NULL)
  `
  log('Self-deploy pipeline stage runs seeded.')

  // ── 7. Trigger Rules — self-healing automation ───────────────────────────────
  await prisma.$executeRaw`
    INSERT INTO trigger_rules (id, tenant_id, event_type, condition, actions, enabled)
    VALUES
      ('10000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid,
       'alert_fired',
       '{"alertName":"AnvayPodCrashLooping"}'::jsonb,
       '[{"type":"open_war_room","severity":"critical"},{"type":"surface_context","message":"Pod crash loop detected — SRE agent triaging"}]'::jsonb,
       true),
      ('10000000-0000-0000-0000-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid,
       'alert_fired',
       '{"alertName":"AnvayHighErrorRate"}'::jsonb,
       '[{"type":"open_war_room","severity":"warning"},{"type":"surface_context","message":"Error rate spike — checking recent deploys"}]'::jsonb,
       true),
      ('10000000-0000-0000-0000-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid,
       'alert_fired',
       '{"alertName":"AnvayDBConnectionsHigh"}'::jsonb,
       '[{"type":"surface_context","message":"DB connection saturation — checking pool config"},{"type":"notify_oncall"}]'::jsonb,
       true),
      ('10000000-0000-0000-0000-000000000004'::uuid, ${DEMO_TENANT_ID}::uuid,
       'alert_fired',
       '{"alertName":"AnvayRedisMemoryHigh"}'::jsonb,
       '[{"type":"surface_context","message":"Redis memory >85% — checking BullMQ failed jobs"},{"type":"notify_oncall"}]'::jsonb,
       true),
      ('10000000-0000-0000-0000-000000000005'::uuid, ${DEMO_TENANT_ID}::uuid,
       'alert_fired',
       '{"alertName":"AnvaySloBurnRateCritical"}'::jsonb,
       '[{"type":"open_war_room","severity":"critical"},{"type":"surface_context","message":"SLO budget burning fast — root cause analysis running"},{"type":"escalate"}]'::jsonb,
       true)
    ON CONFLICT DO NOTHING
  `
  log('5 Trigger rules seeded.')

  // ── 8. Gate Events ────────────────────────────────────────────────────────────
  // pending gate
  await prisma.$executeRaw`
    INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, decided_by, decided_at)
    VALUES (
      '30000000-0000-0000-0000-000000000001'::uuid,
      ${DEMO_TENANT_ID}::uuid,
      ${user.id}::uuid,
      gen_random_uuid(),
      'argocd_rollback',
      '{"app":"payments-api","target_revision":"v2.3.0","namespace":"payments"}'::jsonb,
      'argocd-demo',
      'pending',
      NULL,
      NULL
    )
    ON CONFLICT DO NOTHING
  `
  // approved gate
  await prisma.$executeRaw`
    INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, decided_by, decided_at)
    VALUES (
      '30000000-0000-0000-0000-000000000002'::uuid,
      ${DEMO_TENANT_ID}::uuid,
      ${user.id}::uuid,
      gen_random_uuid(),
      'k8s_restart_deployment',
      '{"namespace":"platform","deployment":"auth-service","reason":"high latency — Redis pool exhaustion"}'::jsonb,
      'k8s-prod',
      'approved',
      ${user.id}::uuid,
      now() - interval '30 minutes'
    )
    ON CONFLICT DO NOTHING
  `
  // rejected gate
  await prisma.$executeRaw`
    INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, decided_by, decided_at)
    VALUES (
      '30000000-0000-0000-0000-000000000003'::uuid,
      ${DEMO_TENANT_ID}::uuid,
      ${user.id}::uuid,
      gen_random_uuid(),
      'scale_deployment',
      '{"namespace":"ml","deployment":"ml-training-service","replicas":0,"reason":"cost reduction during incident"}'::jsonb,
      'k8s-prod',
      'rejected',
      ${user.id}::uuid,
      now() - interval '2 hours'
    )
    ON CONFLICT DO NOTHING
  `
  log('3 Gate events seeded.')

  log('Seed complete.')
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`[seed] Error: ${String(err)}\n`)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
