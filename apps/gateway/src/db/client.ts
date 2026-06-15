import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env['DATABASE_URL'],
    },
  },
})

export const prismaReplica = process.env['DATABASE_REPLICA_URL']
  ? new PrismaClient({
      datasources: {
        db: {
          url: process.env['DATABASE_REPLICA_URL'],
        },
      },
    })
  : null
