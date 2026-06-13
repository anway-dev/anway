#!/usr/bin/env tsx
import { prisma } from '../apps/gateway/src/db/client.js'
import { withTenant } from '../apps/gateway/src/db/prisma.js'
import { encryptJson } from '../apps/gateway/src/utils/crypto.js'

async function main() {
  // Backfill provider_config
  const providers = await prisma.$queryRaw<{ tenant_id: string; api_key: string | null; api_key_enc: string | null }[]>`
    SELECT tenant_id, api_key, api_key_enc FROM provider_config
  `
  for (const p of providers) {
    if (p.api_key && !p.api_key_enc) {
      // Encrypt into _enc AND null the plaintext — leaving plaintext defeats
      // encryption-at-rest. api_key is nullable, so NULL is safe pre-S1.4.
      await withTenant(prisma, p.tenant_id, (tx) =>
        tx.$executeRaw`UPDATE provider_config SET api_key_enc = ${encryptJson(p.api_key)}, api_key = NULL WHERE tenant_id = ${p.tenant_id}::uuid`
      )
      console.log(`provider_config: encrypted api_key for tenant ${p.tenant_id}`)
    }
  }

  // Backfill connector_config
  const connectors = await prisma.$queryRaw<{ tenant_id: string; connector_type: string; credentials: unknown; credentials_enc: string | null }[]>`
    SELECT tenant_id, connector_type, credentials, credentials_enc FROM connector_config
  `
  for (const c of connectors) {
    if (c.credentials && !c.credentials_enc) {
      await withTenant(prisma, c.tenant_id, (tx) =>
        tx.$executeRaw`UPDATE connector_config SET credentials_enc = ${encryptJson(c.credentials)} WHERE tenant_id = ${c.tenant_id}::uuid AND connector_type = ${c.connector_type}`
      )
      console.log(`connector_config: encrypted credentials for ${c.connector_type} tenant ${c.tenant_id}`)
    }
  }

  // Cleanup pass: null any plaintext that already has an encrypted counterpart
  // (covers rows encrypted by an earlier run that left plaintext behind).
  const provCleared = await prisma.$executeRaw`
    UPDATE provider_config SET api_key = NULL WHERE api_key IS NOT NULL AND api_key_enc IS NOT NULL
  `
  const connCleared = await prisma.$executeRaw`
    UPDATE connector_config SET credentials = '{}'::jsonb
    WHERE credentials_enc IS NOT NULL AND credentials IS DISTINCT FROM '{}'::jsonb
  `
  console.log(`cleanup: nulled ${provCleared} provider plaintext, ${connCleared} connector plaintext`)

  console.log('Backfill complete')
}

main().catch(err => { console.error(err); process.exit(1) })
