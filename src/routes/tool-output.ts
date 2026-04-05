/**
 * routes/tool-output.ts — LIN-611 SNOUT-22
 *
 * Output truncation with download URL fallback. When foldToolResult() compresses
 * a large tool response, it saves the full payload to Redis and injects a
 * download URL pointing here. Callers (LLMs, users, clients) can retrieve the
 * complete output within the TTL window (default 24h).
 *
 *   GET  /api/tool-output/:id         — Full JSON envelope {tool_name, content, size_bytes, ...}
 *   GET  /api/tool-output/:id/raw     — Plain content only (text/plain)
 */
import { Router, Request, Response } from 'express'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

export const toolOutputRouter = Router()

const TOOL_OUTPUT_PREFIX = 'orchestrator:tool-output:'
const ID_PATTERN = /^[a-f0-9-]{36}$/ // UUID v4

toolOutputRouter.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id
  if (!ID_PATTERN.test(id)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Tool output ID must be a UUID', status_code: 400 },
    })
    return
  }

  const redis = getRedis()
  if (!redis) {
    res.status(503).json({
      success: false,
      error: { code: 'REDIS_UNAVAILABLE', message: 'Tool output store not available', status_code: 503 },
    })
    return
  }

  try {
    const raw = await redis.get(`${TOOL_OUTPUT_PREFIX}${id}`)
    if (!raw) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tool output not found or expired', status_code: 404 },
      })
      return
    }
    const parsed = JSON.parse(raw)
    // Add remaining TTL for observability
    const ttl = await redis.ttl(`${TOOL_OUTPUT_PREFIX}${id}`)
    res.json({
      success: true,
      data: {
        ...parsed,
        ttl_remaining_seconds: ttl,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn({ id, error: message }, 'Tool output fetch failed')
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message, status_code: 500 },
    })
  }
})

toolOutputRouter.get('/:id/raw', async (req: Request, res: Response) => {
  const id = req.params.id
  if (!ID_PATTERN.test(id)) {
    res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'UUID required', status_code: 400 } })
    return
  }
  const redis = getRedis()
  if (!redis) {
    res.status(503).json({ success: false, error: { code: 'REDIS_UNAVAILABLE', message: 'Tool output store not available', status_code: 503 } })
    return
  }
  try {
    const raw = await redis.get(`${TOOL_OUTPUT_PREFIX}${id}`)
    if (!raw) {
      res.status(404).type('text/plain').send('Not found or expired')
      return
    }
    const parsed = JSON.parse(raw)
    res.type('text/plain; charset=utf-8').send(String(parsed.content ?? ''))
  } catch (err) {
    res.status(500).type('text/plain').send(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
})
