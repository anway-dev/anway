import { AppError } from '@anway/types'
import { Redis } from 'ioredis'
import type { ISessionMemory, MemoryConfig } from '../interfaces/memory.js'
import { RedisSessionMemory } from './redis-session.js'

export class MemoryFactory {
  static create(config: MemoryConfig): ISessionMemory {
    switch (config.type) {
      case 'redis': {
        const client = config.redisUrl ? new Redis(config.redisUrl) : new Redis()
        return new RedisSessionMemory(client, config.summariseProvider)
      }

      default: {
        const _exhaustive: never = config.type
        throw new AppError('VALIDATION_ERROR', `Unknown memory config type: ${String(_exhaustive)}`)
      }
    }
  }
}
