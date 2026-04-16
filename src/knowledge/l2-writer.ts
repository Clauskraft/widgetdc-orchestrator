/**
 * l2-writer.ts — L2 Redis staging writer for the Knowledge Normalization Bus.
 *
 * Persists KnowledgeEvents to Redis with a 7-day TTL under the
 * `knowledge:staging:` key prefix. Handles Redis unavailability gracefully.
 */
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import type { KnowledgeEvent } from './knowledge-bus.js'

const L2_TTL = 7 * 24 * 60 * 60  // 7 days in seconds
const KEY_PREFIX = 'knowledge:staging:'

export async function writeL2(event: KnowledgeEvent): Promise<void> {
  const redis = getRedis()
  if (!redis) {
    logger.warn({ event_id: event.event_id }, 'KnowledgeBus L2: Redis unavailable, skipping staging')
    return
  }
  const key = `${KEY_PREFIX}${event.event_id}`
  await redis.set(key, JSON.stringify(event), 'EX', L2_TTL)
  logger.info({ key, title: event.title, score: event.score }, 'KnowledgeBus L2: staged')
}

export async function listL2(): Promise<KnowledgeEvent[]> {
  const redis = getRedis()
  if (!redis) return []
  const keys = await redis.keys(`${KEY_PREFIX}*`)
  if (keys.length === 0) return []
  const raws = await redis.mget(...keys)
  return raws.filter(Boolean).map(r => JSON.parse(r!) as KnowledgeEvent)
}
