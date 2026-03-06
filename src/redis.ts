/**
 * redis.ts — Optional Redis connection for persistent agent registry.
 *
 * If REDIS_URL is set, provides Redis-backed persistence.
 * Otherwise, falls back gracefully to in-memory only.
 */
import Redis from 'ioredis'
import { logger } from './logger.js'

const redisUrl = process.env['REDIS_URL'] ?? ''

let redis: Redis | null = null

export function getRedis(): Redis | null {
  return redis
}

export function isRedisEnabled(): boolean {
  return redis !== null
}

export async function initRedis(): Promise<void> {
  if (!redisUrl) {
    logger.info('REDIS_URL not set — agent registry will be in-memory only (volatile)')
    return
  }

  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null // stop retrying after 5 attempts
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    await redis.connect()
    logger.info('Redis connected — agent registry persistence enabled')
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis connection failed — falling back to in-memory only')
    redis = null
  }
}
