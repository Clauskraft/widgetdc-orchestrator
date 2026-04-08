/**
 * working-memory.ts — Redis-backed agent working memory (LIN-582 SNOUT-4).
 *
 * Replaces PostgreSQL WorkingMemoryStore from backend.
 * Simple key-value store per agent with TTL and list operations.
 *
 * Redis keys: wm:{agent_id}:{key}
 * TTL: 24h default, configurable per write.
 */
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

export interface MemoryEntry {
  key: string
  value: unknown
  agent_id: string
  created_at: string
  ttl_seconds: number
}

const PREFIX = 'wm:'
const DEFAULT_TTL = 86400 // 24h

export async function storeMemory(
  agentId: string,
  key: string,
  value: unknown,
  ttlSeconds = DEFAULT_TTL,
): Promise<MemoryEntry> {
  const redis = getRedis()
  const redisKey = `${PREFIX}${agentId}:${key}`
  const entry: MemoryEntry = {
    key,
    value,
    agent_id: agentId,
    created_at: new Date().toISOString(),
    ttl_seconds: ttlSeconds,
  }

  if (redis) {
    try {
      await redis.set(redisKey, JSON.stringify(entry), 'EX', ttlSeconds)
    } catch (err) {
      logger.warn({ agentId, key, err: String(err) }, 'Working memory store failed')
    }
  }

  return entry
}

export async function retrieveMemory(agentId: string, key: string): Promise<MemoryEntry | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${PREFIX}${agentId}:${key}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function listMemories(agentId: string): Promise<MemoryEntry[]> {
  const redis = getRedis()
  if (!redis) return []
  try {
    const keys = await redis.keys(`${PREFIX}${agentId}:*`)
    const entries: MemoryEntry[] = []
    for (const k of keys.slice(0, 100)) {
      const raw = await redis.get(k)
      if (raw) entries.push(JSON.parse(raw))
    }
    return entries.sort((a, b) => b.created_at.localeCompare(a.created_at))
  } catch {
    return []
  }
}

export async function deleteMemory(agentId: string, key: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    const result = await redis.del(`${PREFIX}${agentId}:${key}`)
    return result > 0
  } catch {
    return false
  }
}

export async function clearAgentMemory(agentId: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  try {
    const keys = await redis.keys(`${PREFIX}${agentId}:*`)
    if (keys.length === 0) return 0
    return await redis.del(...keys)
  } catch {
    return 0
  }
}
