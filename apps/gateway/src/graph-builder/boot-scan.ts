import { createClient } from 'redis'
import { prisma } from '../db/client.js'

interface Logger { warn(obj: unknown, msg?: string): void; info(obj: unknown, msg?: string): void }

export async function bootstrapUnindexedConnectors(redisUrl: string, log: Logger): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{
    id: string; tenant_id: string; connector_type: string; credentials_enc: string | null
  }>>`
    SELECT id, tenant_id, connector_type, credentials_enc
    FROM connector_config
    WHERE enabled = true AND bootstrapped_at IS NULL
  `.catch(() => [] as Array<{ id: string; tenant_id: string; connector_type: string; credentials_enc: string | null }>)

  if (rows.length === 0) return

  const pub = createClient({ url: redisUrl })
  await pub.connect()
  try {
    for (const row of rows) {
      // connectorId is the row's own UUID, not the bare type — multiple
      // instances of the same connector_type (mcp/cli) must each get their
      // own lock key and be individually identifiable downstream.
      await pub.del(`graph:bootstrap:lock:${row.tenant_id}:${row.id}`).catch(() => {})
      await pub.publish('connector_registered', JSON.stringify({
        type: 'connector_registered',
        tenantId: row.tenant_id,
        connectorType: row.connector_type,
        connectorId: row.id,
        payload: {},
      }))
      log.info({ tenantId: row.tenant_id, connectorType: row.connector_type, connectorId: row.id }, 'boot-scan: cleared lock + published connector_registered for un-indexed connector')
    }
  } finally {
    await pub.quit()
  }
}
