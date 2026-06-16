import { PrismaClient } from '@prisma/client'

function buildDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'] ?? ''
  const poolSize = parseInt(process.env['DB_POOL_SIZE'] ?? '5', 10)
  const sep = url.includes('?') ? '&' : '?'
  if (url.includes('connection_limit')) return url
  return `${url}${sep}connection_limit=${poolSize}&pool_timeout=20`
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: buildDatabaseUrl(),
    },
  },
})

// Service-level client for cross-tenant admin queries (cron scheduler tenant enumeration).
// DATABASE_SERVICE_URL must point to a role with BYPASSRLS in production so that FORCE RLS
// does not filter out rows during global sweeps. Falls back to DATABASE_URL in dev/test.
export const servicePrisma = new PrismaClient({
  datasources: {
    db: {
      url: (() => {
        const url = process.env['DATABASE_SERVICE_URL'] ?? process.env['DATABASE_URL'] ?? ''
        const sep = url.includes('?') ? '&' : '?'
        if (url.includes('connection_limit')) return url
        return `${url}${sep}connection_limit=2&pool_timeout=20`
      })(),
    },
  },
})

export const prismaReplica = process.env['DATABASE_REPLICA_URL']
  ? new PrismaClient({
      datasources: {
        db: {
          url: (() => {
            const url = process.env['DATABASE_REPLICA_URL'] ?? ''
            const sep = url.includes('?') ? '&' : '?'
            if (url.includes('connection_limit')) return url
            return `${url}${sep}connection_limit=5&pool_timeout=20`
          })(),
        },
      },
    })
  : null
