import { createClient } from 'redis'
import type { RedisClientType } from 'redis'

let _redis: RedisClientType | null = null

function getRedis(): RedisClientType | null {
  const url = process.env['REDIS_URL']
  if (!url) return null
  if (!_redis) {
    _redis = createClient({ url }) as RedisClientType
  }
  return _redis
}

export async function checkRateLimit(tenantId: string, connectorType: string, rps: number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true // no Redis → no rate limit
  if (!redis.isOpen) await redis.connect()
  const key = `ratelimit:${tenantId}:${connectorType}:${Math.floor(Date.now() / 1000)}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 2) // 2s window for safety
  return count <= rps
}
