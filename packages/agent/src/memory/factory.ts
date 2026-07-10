import { AppError } from '@anway/types'
import { Redis } from 'ioredis'
import type { ISessionMemory, MemoryConfig } from '../interfaces/memory.js'
import { RedisSessionMemory } from './redis-session.js'

export class MemoryFactory {
  // One shared connection per Redis URL for the whole process. The gateway
  // calls create() on every chat request (summariseProvider is per-tenant) —
  // a new ioredis client per request leaked one live connection per chat
  // call. RedisSessionMemory itself is a cheap stateless wrapper; only the
  // client must be shared.
  private static readonly clients = new Map<string, Redis>()

  static create(config: MemoryConfig): ISessionMemory {
    switch (config.type) {
      case 'redis': {
        const key = config.redisUrl ?? '<default>'
        let client = MemoryFactory.clients.get(key)
        if (!client) {
          client = config.redisUrl ? new Redis(config.redisUrl) : new Redis()
          MemoryFactory.clients.set(key, client)
        }
        return new RedisSessionMemory(client, config.summariseProvider)
      }

      default: {
        const _exhaustive: never = config.type
        throw new AppError('VALIDATION_ERROR', `Unknown memory config type: ${String(_exhaustive)}`)
      }
    }
  }
}
