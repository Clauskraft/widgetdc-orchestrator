/**
 * audit.ts — Enterprise audit trail for all state-changing operations.
 * Logs mutations to Redis (30-day TTL) with actor, timestamp, entity, action.
 */
import { getRedis, isRedisEnabled } from './redis.js'
import { logger } from './logger.js'
import type { Request, Response, NextFunction } from 'express'

export interface AuditEntry {
  id: string
  timestamp: string
  actor: string        // agent_id or 'human' or 'system'
  action: string       // 'register' | 'tool_call' | 'chain_execute' | 'chat_message' | 'cron_trigger' | ...
  entity_type: string  // 'agent' | 'tool' | 'chain' | 'message' | 'cron'
  entity_id: string    // the target id
  method: string       // HTTP method
  path: string         // request path
  status: number       // response status code
  duration_ms: number
  details?: Record<string, unknown>
}

const REDIS_KEY = 'orchestrator:audit'
const MAX_ENTRIES = 1000
const TTL_SECONDS = 30 * 24 * 3600 // 30 days

// In-memory ring buffer fallback
let memoryAudit: AuditEntry[] = []

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    if (isRedisEnabled()) {
      const redis = getRedis()
      if (redis) {
        await redis.lpush(REDIS_KEY, JSON.stringify(entry))
        await redis.ltrim(REDIS_KEY, 0, MAX_ENTRIES - 1)
        await redis.expire(REDIS_KEY, TTL_SECONDS)
        return
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Audit Redis write failed, using memory')
  }

  memoryAudit.unshift(entry)
  if (memoryAudit.length > MAX_ENTRIES) memoryAudit = memoryAudit.slice(0, MAX_ENTRIES)
}

export async function getAuditLog(limit = 100, offset = 0): Promise<AuditEntry[]> {
  try {
    if (isRedisEnabled()) {
      const redis = getRedis()
      if (redis) {
        const raw = await redis.lrange(REDIS_KEY, offset, offset + limit - 1)
        return raw.map(r => JSON.parse(r) as AuditEntry)
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Audit Redis read failed, using memory')
  }

  return memoryAudit.slice(offset, offset + limit)
}

/**
 * Express middleware that logs POST/PATCH/DELETE requests to audit trail.
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') {
    next()
    return
  }

  const start = Date.now()
  const originalEnd = res.end.bind(res)

  // @ts-expect-error - overriding end for audit
  res.end = function (...args: unknown[]) {
    const duration = Date.now() - start

    // Determine actor from body or auth
    const actor = (req.body as Record<string, unknown>)?.agent_id as string
      ?? (req.body as Record<string, unknown>)?.from as string
      ?? 'human'

    // Determine entity from path
    const pathParts = req.path.split('/').filter(Boolean)
    const entityType = pathParts[0] ?? 'unknown'
    const entityId = pathParts[1] ?? (req.body as Record<string, unknown>)?.agent_id as string ?? '-'

    // Determine action
    let action = `${req.method.toLowerCase()}_${entityType}`
    if (req.path.includes('/register')) action = 'register'
    else if (req.path.includes('/call')) action = 'tool_call'
    else if (req.path.includes('/execute')) action = 'chain_execute'
    else if (req.path.includes('/message')) action = 'chat_message'
    else if (req.path.includes('/heartbeat')) action = 'heartbeat'
    else if (req.path.includes('/run')) action = 'cron_trigger'

    const entry: AuditEntry = {
      id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      entity_type: entityType,
      entity_id: String(entityId),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
    }

    // Skip noisy heartbeats from audit details
    if (action !== 'heartbeat') {
      logAudit(entry).catch(() => {})
    }

    // @ts-expect-error - calling original end
    return originalEnd(...args)
  }

  next()
}
