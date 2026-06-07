import { PrismaClient } from '@prisma/client'

export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: typeof prisma) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx as typeof prisma)
  })
}
