import type { SessionId } from '@anvay/types'
import type { ISessionMemory, ConversationTurn, SessionContext, SessionMeta } from '../interfaces/memory.js'
import type { IModelProvider } from '../interfaces/provider.js'
import type { Redis } from 'ioredis'

const SESSION_TTL_SECONDS = 86400 // 24h
const MAX_TURNS_BEFORE_SUMMARISE = 50
const TURNS_TO_KEEP_AFTER_SUMMARISE = 10

function turnsKey(sessionId: string): string {
  return `session:${sessionId}:turns`
}

function metaKey(sessionId: string): string {
  return `session:${sessionId}:meta`
}

/**
 * Redis-backed session memory. Stores turns as a JSON array in Redis with 24h TTL.
 * TTL is refreshed on every append. Auto-summarises when turn count exceeds 50.
 *
 * Call initSession() before using get()/append() so the session has metadata.
 */
export class RedisSessionMemory implements ISessionMemory {
  constructor(
    private readonly redis: Redis,
    private readonly summariseProvider?: IModelProvider,
    private readonly summariseModel = 'claude-haiku-4-5-20251001',
  ) {}

  /**
   * Initialise session metadata. Must be called once before the first append.
   * Idempotent — safe to call again with updated effectiveRole.
   */
  async initSession(meta: SessionMeta): Promise<void> {
    const key = metaKey(meta.sessionId)
    await this.redis.set(key, JSON.stringify(meta), 'EX', SESSION_TTL_SECONDS)
  }

  async get(sessionId: SessionId): Promise<SessionContext | null> {
    const [metaRaw, turnsRaw] = await Promise.all([
      this.redis.get(metaKey(sessionId)),
      this.redis.get(turnsKey(sessionId)),
    ])

    if (!metaRaw) return null

    const meta = JSON.parse(metaRaw) as SessionMeta
    const turns: ConversationTurn[] = turnsRaw ? (JSON.parse(turnsRaw) as ConversationTurn[]) : []

    return { ...meta, turns }
  }

  async append(sessionId: SessionId, turn: ConversationTurn): Promise<void> {
    const key = turnsKey(sessionId)
    const raw = await this.redis.get(key)
    const turns: ConversationTurn[] = raw ? (JSON.parse(raw) as ConversationTurn[]) : []

    turns.push(turn)

    await Promise.all([
      this.redis.set(key, JSON.stringify(turns), 'EX', SESSION_TTL_SECONDS),
      this.redis.expire(metaKey(sessionId), SESSION_TTL_SECONDS),
    ])

    if (turns.length > MAX_TURNS_BEFORE_SUMMARISE) {
      await this.summarise(sessionId)
    }
  }

  async summarise(sessionId: SessionId): Promise<void> {
    const key = turnsKey(sessionId)
    const raw = await this.redis.get(key)
    if (!raw) return

    const turns = JSON.parse(raw) as ConversationTurn[]

    if (turns.length <= TURNS_TO_KEEP_AFTER_SUMMARISE) return

    const toSummarise = turns.slice(0, turns.length - TURNS_TO_KEEP_AFTER_SUMMARISE)
    const toKeep = turns.slice(turns.length - TURNS_TO_KEEP_AFTER_SUMMARISE)

    let summaryContent: string

    if (this.summariseProvider) {
      const prompt = toSummarise
        .map((t) => `${t.role}: ${t.content}`)
        .join('\n')

      const response = await this.summariseProvider.chat(
        [
          {
            role: 'system',
            content:
              'Summarise the following conversation turns into a single concise paragraph preserving key facts, decisions, and context. Be brief.',
          },
          { role: 'user', content: prompt },
        ],
        [],
        { model: this.summariseModel, maxTokens: 512, temperature: 0 },
      )
      summaryContent = response.content
    } else {
      summaryContent = `[Summary of ${toSummarise.length} earlier turns]`
    }

    const summaryTurn: ConversationTurn = {
      role: 'system',
      content: `[SUMMARY] ${summaryContent}`,
      timestamp: Date.now(),
    }

    const compressedTurns = [summaryTurn, ...toKeep]

    await this.redis.set(key, JSON.stringify(compressedTurns), 'EX', SESSION_TTL_SECONDS)

    // Persist summary text into meta for inclusion in SessionContext
    const metaRaw = await this.redis.get(metaKey(sessionId))
    if (metaRaw) {
      const meta = JSON.parse(metaRaw) as SessionMeta
      const updatedMeta: SessionMeta = { ...meta, summary: summaryContent }
      await this.redis.set(metaKey(sessionId), JSON.stringify(updatedMeta), 'EX', SESSION_TTL_SECONDS)
    }
  }

  async clear(sessionId: SessionId): Promise<void> {
    await this.redis.del(turnsKey(sessionId), metaKey(sessionId))
  }
}
