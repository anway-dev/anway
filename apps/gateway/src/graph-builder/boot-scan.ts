import { createClient } from 'redis'
import { prisma } from '../db/client.js'

interface Logger { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void }

export async function bootstrapUnindexedConnectors(redisUrl: string, log: Logger): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{
    tenant_id: string; connector_type: string; credentials_enc: string | null
  }>>`
    SELECT tenant_id, connector_type, credentials_enc
    FROM connector_config
    WHERE enabled = true AND bootstrapped_at IS NULL
  `.catch(() => [] as Array<{ tenant_id: string; connector_type: string; credentials_enc: string | null }>)

  if (rows.length === 0) return

  const pub = createClient({ url: redisUrl })
  await pub.connect()
  try {
    for (const row of rows) {
      await pub.publish('connector_registered', JSON.stringify({
        type: 'connector_registered',
        tenantId: row.tenant_id,
        connectorType: row.connector_type,
        connectorId: row.connector_type,
        payload: {},
      }))
      log.info({ tenantId: row.tenant_id, connectorType: row.connector_type }, 'boot-scan: published connector_registered for un-indexed connector')
    }
  } finally {
    await pub.quit()
  }
}
