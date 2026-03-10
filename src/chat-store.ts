/**
 * chat-store.ts — Persistent chat message storage via Redis.
 *
 * Messages are stored as a Redis list (LPUSH) with 7-day TTL.
 * Supports: history retrieval, thread grouping, search, and summaries.
 * Falls back to in-memory ring buffer if Redis is unavailable.
 */
import { getRedis, isRedisEnabled } from './redis.js'
import { logger } from './logger.js'
import type { StoredMessage } from '@widgetdc/contracts/orchestrator'
export type { StoredMessage }

const REDIS_KEY = 'orchestrator:messages'
const REDIS_THREADS_KEY = 'orchestrator:threads'   // hash: thread_id → thread meta
const REDIS_PINS_KEY = 'orchestrator:pinned'        // set of message ids
const MAX_MESSAGES = 2000
const TTL_SECONDS = 7 * 24 * 3600 // 7 days

// In-memory fallback
let memoryMessages: StoredMessage[] = []

/** Generate a short unique message id */
export function msgId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Store a message (Redis + memory) */
export async function storeMessage(msg: StoredMessage): Promise<void> {
  // Always keep in memory for fast access
  memoryMessages.unshift(msg)
  if (memoryMessages.length > MAX_MESSAGES) memoryMessages = memoryMessages.slice(0, MAX_MESSAGES)

  // Persist to Redis
  try {
    if (isRedisEnabled()) {
      const redis = getRedis()
      if (redis) {
        await redis.lpush(REDIS_KEY, JSON.stringify(msg))
        await redis.ltrim(REDIS_KEY, 0, MAX_MESSAGES - 1)
        await redis.expire(REDIS_KEY, TTL_SECONDS)

        // Track thread metadata
        if (msg.thread_id) {
          const threadMeta = JSON.stringify({
            thread_id: msg.thread_id,
            last_reply: msg.timestamp,
            reply_count: 0, // incremented separately
          })
          await redis.hset(REDIS_THREADS_KEY, msg.thread_id, threadMeta)
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Chat store Redis write failed')
  }
}

/** Get message history (newest first) */
export async function getHistory(limit = 100, offset = 0, target?: string): Promise<StoredMessage[]> {
  let messages: StoredMessage[] = []

  try {
    if (isRedisEnabled()) {
      const redis = getRedis()
      if (redis) {
        const raw = await redis.lrange(REDIS_KEY, offset, offset + limit * 2 - 1) // fetch extra for filtering
        messages = raw.map(r => JSON.parse(r) as StoredMessage)
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Chat store Redis read failed')
  }

  // Fallback to memory
  if (messages.length === 0) {
    messages = memoryMessages.slice(offset, offset + limit * 2)
  }

  // Filter by conversation target if specified
  if (target && target !== 'All') {
    messages = messages.filter(m =>
      m.from === target || m.to === target || m.to === 'All'
    )
  }

  return messages.slice(0, limit)
}

/** Get thread messages (all replies to a root message) */
export async function getThread(threadId: string): Promise<StoredMessage[]> {
  const all = await getHistory(MAX_MESSAGES, 0)
  return all
    .filter(m => m.thread_id === threadId || m.id === threadId)
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
}

/** Search messages by text content */
export async function searchMessages(query: string, limit = 50): Promise<StoredMessage[]> {
  const all = await getHistory(MAX_MESSAGES, 0)
  const q = query.toLowerCase()
  return all
    .filter(m => (m.message || '').toLowerCase().includes(q) ||
                 (m.from || '').toLowerCase().includes(q))
    .slice(0, limit)
}

/** Pin/unpin a message */
export async function togglePin(messageId: string, pin: boolean): Promise<void> {
  try {
    if (isRedisEnabled()) {
      const redis = getRedis()
      if (redis) {
        if (pin) await redis.sadd(REDIS_PINS_KEY, messageId)
        else await redis.srem(REDIS_PINS_KEY, messageId)
      }
    }
  } catch {}

  // Update in memory
  const msg = memoryMessages.find(m => m.id === messageId)
  if (msg) msg.pinned = pin
}

/** Get pinned messages */
export async function getPinnedMessages(): Promise<StoredMessage[]> {
  let pinnedIds: string[] = []
  try {
    if (isRedisEnabled()) {
      const redis = getRedis()
      if (redis) pinnedIds = await redis.smembers(REDIS_PINS_KEY)
    }
  } catch {}

  if (pinnedIds.length === 0) {
    return memoryMessages.filter(m => m.pinned)
  }

  const all = await getHistory(MAX_MESSAGES, 0)
  return all.filter(m => pinnedIds.includes(m.id))
}

/** Hydrate memory from Redis on boot */
export async function hydrateMessages(): Promise<void> {
  try {
    if (isRedisEnabled()) {
      const redis = getRedis()
      if (redis) {
        const raw = await redis.lrange(REDIS_KEY, 0, MAX_MESSAGES - 1)
        memoryMessages = raw.map(r => JSON.parse(r) as StoredMessage)
        logger.info({ count: memoryMessages.length }, 'Chat history hydrated from Redis')
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Chat history hydration failed')
  }
}

/** Get conversation summary data (for sidebar) */
export function getConversationSummaries(): Array<{
  target: string
  lastMessage: string
  lastTime: string
  messageCount: number
}> {
  const convMap = new Map<string, { lastMessage: string; lastTime: string; count: number }>()

  for (const m of memoryMessages) {
    const partner = m.from === 'command-center' ? m.to : m.from
    if (!partner) continue
    const existing = convMap.get(partner)
    if (!existing) {
      convMap.set(partner, {
        lastMessage: (m.message || '').slice(0, 80),
        lastTime: m.timestamp,
        count: 1,
      })
    } else {
      existing.count++
      if (m.timestamp > existing.lastTime) {
        existing.lastMessage = (m.message || '').slice(0, 80)
        existing.lastTime = m.timestamp
      }
    }
  }

  return Array.from(convMap.entries())
    .map(([target, data]) => ({ target, ...data, messageCount: data.count }))
    .sort((a, b) => (b.lastTime || '').localeCompare(a.lastTime || ''))
}
