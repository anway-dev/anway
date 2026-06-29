import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const log = (msg: string) => process.stdout.write(`[seed] ${msg}\n`)

// Core init (tenant + user + environments) happens via POST /api/auth/setup on first run.
// This seed only loads demo fixture data for UI development / demos.
// Usage: SEED_DEMO=true pnpm db:seed

const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001'

async function seedDemo() {
  log('Seeding demo fixtures (SEED_DEMO=true)...')

  // Ensure tenant + environments exist (idempotent)
  await prisma.$executeRaw`
    INSERT INTO tenants (id, name, slug, plan, token_budget_monthly, connector_limit)
    VALUES (${DEMO_TENANT_ID}::uuid, 'Acme Corp (Demo)', 'demo', 'tier2', 10000000, 10)
    ON CONFLICT (id) DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO environments (id, tenant_id, name, label, color, sort_order)
    VALUES
      ('00000000-0000-0000-0001-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid, 'staging', 'Staging',        '#3b82f6', 0),
      ('00000000-0000-0000-0001-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid, 'preprod', 'Pre-production', '#f59e0b', 1),
      ('00000000-0000-0000-0001-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid, 'prod',    'Production',     '#10b981', 2)
    ON CONFLICT (id) DO NOTHING
  `

  const user = await prisma.user.upsert({
    where: { tenant_id_email: { tenant_id: DEMO_TENANT_ID, email: 'admin@demo.anvay.dev' } },
    update: {},
    create: { tenant_id: DEMO_TENANT_ID, email: 'admin@demo.anvay.dev', role: 'admin' },
  })
  log(`User: ${user.email}`)

  await prisma.connector.createMany({
    skipDuplicates: true,
    data: [
      { tenant_id: DEMO_TENANT_ID, name: 'GitHub (Demo)',    type: 'cli', mode: 'read', config_enc: JSON.stringify({ binary: 'gh',     allowedSubcommands: ['pr list', 'issue list', 'run list'] }),   capability_manifest: { capabilities: { read: ['org/*'], write: [] } } },
      { tenant_id: DEMO_TENANT_ID, name: 'PagerDuty (Demo)', type: 'cli', mode: 'read', config_enc: JSON.stringify({ binary: 'pd',     allowedSubcommands: ['incident list', 'incident view'] }),      capability_manifest: { capabilities: { read: ['*'],     write: [] } } },
      { tenant_id: DEMO_TENANT_ID, name: 'ArgoCD (Demo)',    type: 'cli', mode: 'read', config_enc: JSON.stringify({ binary: 'argocd', allowedSubcommands: ['app list', 'app get'] }),                 capability_manifest: { capabilities: { read: ['*'],     write: [] } } },
    ],
  })

  await prisma.$executeRaw`
    INSERT INTO entities (tenant_id, type, name, metadata) VALUES
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
      (${DEMO_TENANT_ID}::uuid, 'Service', 'reporting-service',     '{"language":"TypeScript","tier":"medium","team":"data-team"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'payments', '{"cluster":"prod-us-east","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'orders',   '{"cluster":"prod-us-east","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'platform', '{"cluster":"prod-us-east","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'ml',       '{"cluster":"prod-us-west","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Namespace', 'data',     '{"cluster":"prod-us-east","env":"prod"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'platform-sre',  '{"slack":"#platform-sre"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'payments-team', '{"slack":"#payments"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'data-team',     '{"slack":"#data"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'infra-team',    '{"slack":"#infra"}'::jsonb),
      (${DEMO_TENANT_ID}::uuid, 'Team', 'platform',      '{"slack":"#platform"}'::jsonb)
    ON CONFLICT (tenant_id, type, name) DO NOTHING
  `
  log('Entities seeded (22 services, 5 namespaces, 5 teams).')

  await prisma.incident.createMany({
    skipDuplicates: true,
    data: [
      { id: '10000000-0000-0000-0000-000000000001', tenant_id: DEMO_TENANT_ID, title: 'payments-api error rate spike: 12% errors in prod',           severity: 'critical', status: 'active',        description: 'Error rate on payments-api crossed 10% threshold at 14:32 UTC.',                                    suggested_root_cause: 'v2.3.1 deploy 14 min ago — billing-logic refactor, unhandled edge case for international cards.', created_at: new Date(Date.now() - 25 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000002', tenant_id: DEMO_TENANT_ID, title: 'auth-service elevated latency: P99 at 4.1s',                   severity: 'high',     status: 'active',        description: 'auth-service P99 latency crossed 4s SLO. Token validation most affected.',                         suggested_root_cause: 'Redis connection pool exhaustion — session spike from marketing campaign.',                         created_at: new Date(Date.now() - 10 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000003', tenant_id: DEMO_TENANT_ID, title: 'notification-service: email delivery delay > 8 min',           severity: 'medium',   status: 'active',        description: 'Email delivery queue backed up. Average delay 8.4 min vs SLO 2 min.',                              suggested_root_cause: 'SES rate limit — high order volume from flash sale.',                                               created_at: new Date(Date.now() - 45 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000004', tenant_id: DEMO_TENANT_ID, title: 'fraud-detection: model serving degraded — 60% latency increase',severity: 'critical', status: 'investigating', description: 'Model inference latency spiked 45ms → 110ms. Checkout flows timing out.',                           suggested_root_cause: 'GPU node rescheduled after spot preemption. Model on fallback CPU node.',                           created_at: new Date(Date.now() - 90 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000005', tenant_id: DEMO_TENANT_ID, title: 'data-warehouse: nightly ETL job failing on orders table',       severity: 'high',     status: 'investigating', description: "ETL job failed 02:14 UTC. Downstream reports stale.",                                              suggested_root_cause: 'Schema drift: order-service added nullable column without migrating warehouse schema.',             created_at: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000006', tenant_id: DEMO_TENANT_ID, title: 'search-service: index rebuild caused 3-minute outage',          severity: 'high',     status: 'resolved',      description: 'Full index rebuild during peak traffic. 3-min complete outage on product search.',                  suggested_root_cause: 'Index rebuild cron not respecting traffic-based backoff window.',                                  created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),  resolved_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000007', tenant_id: DEMO_TENANT_ID, title: 'inventory-service: stock count drift on 3 SKUs',                severity: 'medium',   status: 'resolved',      description: 'Stock counts drifted from warehouse truth by up to 200 units.',                                     suggested_root_cause: 'Race condition in optimistic locking during concurrent cart checkouts.',                            created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),  resolved_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 47 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000008', tenant_id: DEMO_TENANT_ID, title: 'api-gateway: cert renewal failed — TLS handshake errors EU',    severity: 'high',     status: 'resolved',      description: "eu-west-1 cert expired. ~8 min of SSL errors for EU customers.",                                    suggested_root_cause: "cert-manager failed renew — Let's Encrypt rate limit hit.",                                        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),  resolved_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 8 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000009', tenant_id: DEMO_TENANT_ID, title: 'reporting-service: daily PDF export slow (>60s)',                severity: 'low',      status: 'resolved',      description: 'Large tenant exports timing out at 60s. Exports > 50k rows failed silently.',                      suggested_root_cause: 'Missing pagination on DB query.',                                                                  created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), resolved_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000) },
      { id: '10000000-0000-0000-0000-000000000010', tenant_id: DEMO_TENANT_ID, title: 'cdn-service: cache purge loop — origin stampede',               severity: 'medium',   status: 'resolved',      description: 'Cache invalidation bug — CDN nodes simultaneously purged, origin bandwidth 8x for 12 min.',        suggested_root_cause: 'Cache-control header missing max-stale. Each node purged independently.',                          created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), resolved_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000 + 12 * 60 * 1000) },
    ],
  })
  log('10 Incidents seeded.')

  await prisma.$executeRaw`
    INSERT INTO pipelines (id, tenant_id, name, description, stages, status, metadata) VALUES
      ('20000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid, 'payments-api-deploy',    'CI/CD pipeline for payments-api',   '[{"id":"build","name":"Build & Test"},{"id":"security-scan","name":"Security Scan"},{"id":"deploy-staging","name":"Deploy to Staging"},{"id":"integration-tests","name":"Integration Tests"},{"id":"deploy-prod","name":"Deploy to Production"}]'::jsonb, 'running', '{"service":"payments-api","triggered_by":"pr_merged","sha":"a4f21bc9"}'::jsonb),
      ('20000000-0000-0000-0000-000000000002'::uuid, ${DEMO_TENANT_ID}::uuid, 'auth-service-deploy',    'CI/CD pipeline for auth-service',   '[{"id":"build","name":"Build & Test"},{"id":"security-scan","name":"Security Scan"},{"id":"deploy-staging","name":"Deploy to Staging"},{"id":"integration-tests","name":"Integration Tests"},{"id":"deploy-prod","name":"Deploy to Production"}]'::jsonb, 'success', '{"service":"auth-service","triggered_by":"pr_merged","sha":"c8b3d44f"}'::jsonb),
      ('20000000-0000-0000-0000-000000000003'::uuid, ${DEMO_TENANT_ID}::uuid, 'platform-release',       'Weekly platform release train',     '[{"id":"changelog","name":"Changelog Generation"},{"id":"build-all","name":"Build All Services"},{"id":"smoke-tests","name":"Smoke Tests"},{"id":"canary-prod","name":"Canary Deploy"},{"id":"full-prod","name":"Full Production Rollout"}]'::jsonb,        'failed',  '{"version":"v1.14.0","triggered_by":"schedule"}'::jsonb),
      ('20000000-0000-0000-0000-000000000005'::uuid, ${DEMO_TENANT_ID}::uuid, 'checkout-service-deploy','CI/CD pipeline for checkout-service','[{"id":"build","name":"Build & Test"},{"id":"security-scan","name":"Security Scan"},{"id":"deploy-staging","name":"Deploy to Staging"},{"id":"integration-tests","name":"Integration Tests"},{"id":"deploy-prod","name":"Deploy to Production"}]'::jsonb, 'idle',    '{"service":"checkout-service","triggered_by":"manual"}'::jsonb),
      ('40000000-0000-0000-0000-000000000001'::uuid, ${DEMO_TENANT_ID}::uuid, 'anvay-self-deploy',      'Anvay deploys itself',              '[{"id":"build","label":"Build Images","type":"build"},{"id":"test","label":"Type Check + CI","type":"test"},{"id":"gate-staging","label":"Staging Gate","type":"gate"},{"id":"deploy-staging","label":"Deploy Staging","type":"deploy"},{"id":"monitor","label":"Monitor 10min","type":"monitor"},{"id":"gate-prod","label":"Production Gate","type":"gate"},{"id":"deploy-prod","label":"Deploy Production","type":"deploy"}]'::jsonb, 'running', '{"sha":"a4f21bc9","triggered_by":"pr_merged","service":"anvay"}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `
  await prisma.$executeRaw`
    INSERT INTO pipeline_stage_runs (id, pipeline_id, tenant_id, stage_id, status, output, started_at, finished_at) VALUES
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'build',             'success','{"duration_ms":42300,"tests_passed":847,"tests_failed":0}'::jsonb,                                             now()-interval'18m',now()-interval'11m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'security-scan',     'success','{"vulnerabilities":0,"advisories":2,"scan_tool":"trivy"}'::jsonb,                                              now()-interval'11m',now()-interval'8m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'deploy-staging',    'success','{"pods_updated":3,"rollout_duration_ms":38000}'::jsonb,                                                        now()-interval'8m', now()-interval'3m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'integration-tests', 'running','{}':jsonb,                                                                                                    now()-interval'3m', NULL),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'deploy-prod',       'pending','{}':jsonb,                                                                                                    NULL,NULL),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000002'::uuid,${DEMO_TENANT_ID}::uuid,'build',             'success','{"duration_ms":31200,"tests_passed":612,"tests_failed":0}'::jsonb,                                             now()-interval'3h',now()-interval'3h'+interval'8m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000002'::uuid,${DEMO_TENANT_ID}::uuid,'security-scan',     'success','{"vulnerabilities":0,"advisories":0,"scan_tool":"trivy"}'::jsonb,                                              now()-interval'3h'+interval'8m',now()-interval'3h'+interval'11m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000002'::uuid,${DEMO_TENANT_ID}::uuid,'deploy-staging',    'success','{"pods_updated":2,"rollout_duration_ms":22000}'::jsonb,                                                        now()-interval'3h'+interval'11m',now()-interval'3h'+interval'18m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000002'::uuid,${DEMO_TENANT_ID}::uuid,'integration-tests', 'success','{"tests_passed":94,"tests_failed":0,"duration_ms":180000}'::jsonb,                                             now()-interval'3h'+interval'18m',now()-interval'3h'+interval'21m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000002'::uuid,${DEMO_TENANT_ID}::uuid,'deploy-prod',       'success','{"pods_updated":4,"rollout_duration_ms":55000,"canary_traffic_pct":100}'::jsonb,                               now()-interval'3h'+interval'21m',now()-interval'3h'+interval'30m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000003'::uuid,${DEMO_TENANT_ID}::uuid,'changelog',         'success','{"entries":14,"breaking_changes":0}'::jsonb,                                                                   now()-interval'6h',now()-interval'6h'+interval'2m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000003'::uuid,${DEMO_TENANT_ID}::uuid,'build-all',         'success','{"services_built":8,"duration_ms":284000}'::jsonb,                                                             now()-interval'6h'+interval'2m',now()-interval'6h'+interval'49m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000003'::uuid,${DEMO_TENANT_ID}::uuid,'smoke-tests',       'success','{"tests_passed":42,"tests_failed":0}'::jsonb,                                                                  now()-interval'6h'+interval'49m',now()-interval'6h'+interval'53m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000003'::uuid,${DEMO_TENANT_ID}::uuid,'canary-prod',       'failed', '{"error":"canary error rate 8.2% exceeded threshold 2%","rolled_back":true}'::jsonb,                           now()-interval'6h'+interval'53m',now()-interval'6h'+interval'61m'),
      (gen_random_uuid(),'20000000-0000-0000-0000-000000000003'::uuid,${DEMO_TENANT_ID}::uuid,'full-prod',         'pending','{}':jsonb,                                                                                                    NULL,NULL),
      (gen_random_uuid(),'40000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'build',             'success','{"duration_ms":62000,"images":["anvay-gateway","anvay-web","anvay-agent-service"]}'::jsonb,                    now()-interval'28m',now()-interval'19m'),
      (gen_random_uuid(),'40000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'test',              'running','{"tsc":"pass","packages":14,"gateway_tests":{"passed":62},"agent_tests":{"passed":93}}'::jsonb,               now()-interval'19m',NULL),
      (gen_random_uuid(),'40000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'gate-staging',      'pending','{}':jsonb,NULL,NULL),
      (gen_random_uuid(),'40000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'deploy-staging',    'pending','{}':jsonb,NULL,NULL),
      (gen_random_uuid(),'40000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'monitor',           'pending','{}':jsonb,NULL,NULL),
      (gen_random_uuid(),'40000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'gate-prod',         'pending','{}':jsonb,NULL,NULL),
      (gen_random_uuid(),'40000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'deploy-prod',       'pending','{}':jsonb,NULL,NULL)
  `
  log('5 Pipelines + stage runs seeded.')

  await prisma.$executeRaw`
    INSERT INTO trigger_rules (id, tenant_id, event_type, condition, actions, enabled) VALUES
      ('10000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,'alert_fired','{"alertName":"AnvayPodCrashLooping"}'::jsonb,    '[{"type":"open_war_room","severity":"critical"},{"type":"surface_context","message":"Pod crash loop detected"}]'::jsonb,true),
      ('10000000-0000-0000-0000-000000000002'::uuid,${DEMO_TENANT_ID}::uuid,'alert_fired','{"alertName":"AnvayHighErrorRate"}'::jsonb,       '[{"type":"open_war_room","severity":"warning"},{"type":"surface_context","message":"Error rate spike — checking recent deploys"}]'::jsonb,true),
      ('10000000-0000-0000-0000-000000000003'::uuid,${DEMO_TENANT_ID}::uuid,'alert_fired','{"alertName":"AnvayDBConnectionsHigh"}'::jsonb,   '[{"type":"surface_context","message":"DB connection saturation"},{"type":"notify_oncall"}]'::jsonb,true),
      ('10000000-0000-0000-0000-000000000004'::uuid,${DEMO_TENANT_ID}::uuid,'alert_fired','{"alertName":"AnvayRedisMemoryHigh"}'::jsonb,     '[{"type":"surface_context","message":"Redis memory >85%"},{"type":"notify_oncall"}]'::jsonb,true),
      ('10000000-0000-0000-0000-000000000005'::uuid,${DEMO_TENANT_ID}::uuid,'alert_fired','{"alertName":"AnvaySloBurnRateCritical"}'::jsonb, '[{"type":"open_war_room","severity":"critical"},{"type":"surface_context","message":"SLO budget burning fast"},{"type":"escalate"}]'::jsonb,true)
    ON CONFLICT (id) DO NOTHING
  `
  log('5 Trigger rules seeded.')

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL row_security = off`
    await tx.$executeRaw`
      INSERT INTO cron_jobs (id, tenant_id, name, schedule, job_type, enabled, last_run_at, last_result) VALUES
        (gen_random_uuid(),${DEMO_TENANT_ID}::uuid,'Service Health Sweep',  '*/5 * * * *','service_health_sweep',   true,NOW()-INTERVAL'3m', '{"status":"ok","findings":0}'::jsonb),
        (gen_random_uuid(),${DEMO_TENANT_ID}::uuid,'SLO Burn Check',        '*/5 * * * *','slo_burn_check',         true,NOW()-INTERVAL'4m', '{"status":"ok","services":3}'::jsonb),
        (gen_random_uuid(),${DEMO_TENANT_ID}::uuid,'Deploy Health Report',  '0 * * * *',  'deploy_health_report',   true,NOW()-INTERVAL'1h', '{"status":"ok","deploys":7}'::jsonb),
        (gen_random_uuid(),${DEMO_TENANT_ID}::uuid,'Oncall Morning Brief',  '0 8 * * *',  'oncall_morning_brief',   true,NOW()-INTERVAL'4h', '{"status":"ok","brief":"All services nominal"}'::jsonb),
        (gen_random_uuid(),${DEMO_TENANT_ID}::uuid,'Cloud Security Scan',   '0 */6 * * *','cloud_security_scan',    true,NOW()-INTERVAL'2h', '{"status":"ok","findings":0}'::jsonb),
        (gen_random_uuid(),${DEMO_TENANT_ID}::uuid,'Cost Anomaly Detection','0 1 * * *',  'cost_anomaly_detection', true,NOW()-INTERVAL'8h', '{"status":"ok","anomalies":0}'::jsonb)
      ON CONFLICT DO NOTHING
    `
  })
  log('6 System monitors seeded.')

  const userId = user.id
  await prisma.$executeRaw`
    INSERT INTO gate_events (id, tenant_id, user_id, session_id, tool_name, tool_args, connector_id, status, decided_by, decided_at) VALUES
      ('30000000-0000-0000-0000-000000000001'::uuid,${DEMO_TENANT_ID}::uuid,${userId}::uuid,gen_random_uuid(),'argocd_rollback',        '{"app":"payments-api","target_revision":"v2.3.0","namespace":"payments"}'::jsonb,                              'argocd-demo','pending', NULL,            NULL),
      ('30000000-0000-0000-0000-000000000002'::uuid,${DEMO_TENANT_ID}::uuid,${userId}::uuid,gen_random_uuid(),'k8s_restart_deployment', '{"namespace":"platform","deployment":"auth-service","reason":"high latency"}'::jsonb,                         'k8s-prod',   'approved',${userId}::uuid,now()-interval'30m'),
      ('30000000-0000-0000-0000-000000000003'::uuid,${DEMO_TENANT_ID}::uuid,${userId}::uuid,gen_random_uuid(),'scale_deployment',       '{"namespace":"ml","deployment":"ml-training-service","replicas":0,"reason":"cost reduction"}'::jsonb,'k8s-prod','rejected',${userId}::uuid,now()-interval'2h')
    ON CONFLICT (id) DO NOTHING
  `
  log('3 Gate events seeded.')
  log('Demo seed complete.')
}

async function main() {
  if (process.env['SEED_DEMO'] !== 'true') {
    log('Nothing to seed. Core init happens via POST /api/auth/setup on first run.')
    log('Use SEED_DEMO=true to load demo fixtures.')
    return
  }
  await seedDemo()
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`[seed] Error: ${String(err)}\n`)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
