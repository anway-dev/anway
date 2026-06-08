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
    ON CONFLICT (slug) DO UPDATE SET id = ${DEMO_TENANT_ID}::uuid
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

  // Seed connectors with correct nested capability_manifest format
  await prisma.connector.createMany({
    skipDuplicates: true,
    data: [
      { tenant_id: tenant.id, name: 'GitHub (Demo)', type: 'github', mode: 'read', config_encrypted: {}, capability_manifest: { capabilities: { read: ['org/*'], write: [] } } },
      { tenant_id: tenant.id, name: 'Linear (Demo)', type: 'linear', mode: 'read', config_encrypted: {}, capability_manifest: { capabilities: { read: ['*'], write: [] } } },
      { tenant_id: tenant.id, name: 'PagerDuty (Demo)', type: 'pagerduty', mode: 'read', config_encrypted: {}, capability_manifest: { capabilities: { read: ['*'], write: [] } } },
      { tenant_id: tenant.id, name: 'ArgoCD (Demo)', type: 'argocd', mode: 'read', config_encrypted: {}, capability_manifest: { capabilities: { read: ['*'], write: [] } } },
    ],
  })
  log('Connectors seeded.')

  // Seed KB entities so resolveContextByName has something to resolve
  await prisma.$executeRaw`
    INSERT INTO entities (tenant_id, type, name, metadata)
    VALUES
      (${tenant.id}::uuid, 'Service', 'payments-api', '{"language":"TypeScript","tier":"critical"}'::jsonb),
      (${tenant.id}::uuid, 'Service', 'auth-service', '{"language":"Go","tier":"critical"}'::jsonb),
      (${tenant.id}::uuid, 'Team', 'platform', '{"slack":"#platform"}'::jsonb)
    ON CONFLICT (tenant_id, type, name) DO NOTHING
  `
  log('KB entities seeded.')

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
