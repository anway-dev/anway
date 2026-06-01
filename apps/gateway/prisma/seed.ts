import { PrismaClient } from '@prisma/client'
import { createWriteStream } from 'fs'

const prisma = new PrismaClient()

const log = (msg: string) => process.stdout.write(`[seed] ${msg}\n`)

async function main() {
  log('Starting seed...')

  // tenants table uses FORCE ROW LEVEL SECURITY — superuser still bypasses by default
  // but we set the context variable anyway so the seed works in both modes
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Acme Corp (Demo)',
      slug: 'demo',
      plan: 'tier2',
      token_budget_monthly: 10_000_000,
      connector_limit: 10,
    },
  })
  log(`Tenant: ${tenant.slug} (${tenant.id})`)

  // Set RLS session variable so subsequent writes pass the tenant_isolation policy
  await prisma.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant.id}'`)

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

  const connector = await prisma.connector.create({
    data: {
      tenant_id: tenant.id,
      name: 'GitHub (Demo)',
      type: 'github',
      mode: 'read',
      config_encrypted: {},
      capability_manifest: {
        read: { scope: ['org/*'] },
        write: {},
      },
    },
  })
  log(`Connector: ${connector.name} (mode=${connector.mode})`)

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
