/**
 * routes/fold.ts — Context-as-a-Service (CaaS) Mercury Folding API (LIN-568).
 *
 *   POST /api/fold — Public folding endpoint wrapping RLM Engine's /cognitive/fold.
 *
 * Rate limit: 100 requests/day per API key.
 * Usage logged to Redis for metering.
 */
import { Router, Request, Response } from 'express'
import { isRlmAvailable } from '../cognitive-proxy.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { StrategicDistiller, type DistillationStrategy } from '../memory/strategic-distiller.js'

export const foldRouter = Router()

const DAILY_LIMIT = 100
const REDIS_PREFIX = 'caas:usage:'
const strategicDistiller = new StrategicDistiller()

/**
 * Get today's usage count for a given API key.
 */
async function getUsageCount(apiKey: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  const today = new Date().toISOString().slice(0, 10)
  const key = `${REDIS_PREFIX}${today}:${apiKey}`
  const count = await redis.get(key)
  return parseInt(count ?? '0', 10)
}

/**
 * Increment usage count for today.
 */
async function incrementUsage(apiKey: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const today = new Date().toISOString().slice(0, 10)
  const key = `${REDIS_PREFIX}${today}:${apiKey}`
  await redis.incr(key)
  await redis.expire(key, 86400 * 2) // 2 day TTL for overlap
}

/**
 * Log usage event for metering.
 */
async function logUsage(apiKey: string, inputTokens: number, outputTokens: number, durationMs: number): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const event = JSON.stringify({
    $id: `caas-usage:${Date.now()}`,
    api_key: apiKey.slice(0, 8) + '...',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_ms: durationMs,
    timestamp: new Date().toISOString(),
  })
  await redis.lpush('caas:usage-log', event).catch(() => {})
  await redis.ltrim('caas:usage-log', 0, 9999).catch(() => {}) // Keep last 10k events
}

/**
 * POST /api/fold — Mercury Folding as a Service.
 *
 * Body: { text: string, query?: string, budget?: number, strategy?: string }
 * Returns: { success: true, data: { folded_text, tokens_saved, compression_ratio } }
 */
foldRouter.post('/', async (req: Request, res: Response) => {
  // Check RLM availability
  if (!isRlmAvailable()) {
    res.status(503).json({
      success: false,
      error: { code: 'RLM_UNAVAILABLE', message: 'Mercury Folding backend not configured', status_code: 503 },
    })
    return
  }

  // P1 fix: reject fold if Redis unavailable (rate limiting requires Redis)
  if (!getRedis()) {
    res.status(503).json({
      success: false,
      error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Rate limiting backend (Redis) not available. Fold disabled.', status_code: 503 },
    })
    return
  }

  // Extract API key for rate limiting
  const apiKey = req.headers['authorization']?.replace('Bearer ', '') ??
    (req.headers['x-api-key'] as string) ??
    (req.query['api_key'] as string) ?? 'anonymous'

  // Rate limit check
  const usage = await getUsageCount(apiKey)
  if (usage >= DAILY_LIMIT) {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Daily limit of ${DAILY_LIMIT} requests exceeded. Resets at midnight UTC.`,
        status_code: 429,
        usage: { today: usage, limit: DAILY_LIMIT },
      },
    })
    return
  }

  // Validate body
  const body = req.body as { text?: string; query?: string; budget?: number; strategy?: string }
  if (!body.text || typeof body.text !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: text (string)', status_code: 400 },
    })
    return
  }

  if (body.text.length > 100000) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'text must be under 100,000 characters', status_code: 400 },
    })
    return
  }

  // P3: Budget and strategy validation
  const VALID_STRATEGIES = ['semantic', 'extractive', 'hybrid']
  const budget = typeof body.budget === 'number' && body.budget >= 100 && body.budget <= 50000 ? body.budget : 2000
  const strategy = typeof body.strategy === 'string' && VALID_STRATEGIES.includes(body.strategy) ? body.strategy as DistillationStrategy : 'semantic'

  const t0 = Date.now()

  try {
    const distillation = await strategicDistiller.distill({
      text: body.text,
      budget,
      strategy,
      query: body.query,
    })
    const result = distillation.folded_text

    const durationMs = Date.now() - t0
    const inputTokens = Math.ceil(body.text.length / 4) // rough estimate
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
    const outputTokens = Math.ceil(resultStr.length / 4)

    // Increment rate limit + log usage
    await incrementUsage(apiKey)
    await logUsage(apiKey, inputTokens, outputTokens, durationMs)

    res.json({
      success: true,
      data: {
        $id: `fold-result:${Date.now()}`,
        folded_text: result,
        input_chars: body.text.length,
        output_chars: resultStr.length,
        compression_ratio: resultStr.length > 0 ? +(body.text.length / resultStr.length).toFixed(2) : 0,
        tokens_saved_estimate: Math.max(0, inputTokens - outputTokens),
        duration_ms: durationMs,
        strategy,
        memory_sources: distillation.source_count,
        memory_summary: distillation.memory_summary,
        bom_components: distillation.bom_components,
        compression_mode: distillation.compression_mode,
        graph_weight_profile: distillation.graph_weight_profile,
      },
      usage: {
        today: usage + 1,
        limit: DAILY_LIMIT,
        remaining: DAILY_LIMIT - usage - 1,
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'CaaS fold request failed')
    res.status(502).json({
      success: false,
      error: { code: 'FOLD_FAILED', message: 'Mercury Folding request failed. Check server logs.', status_code: 502 },
    })
  }
})

/**
 * GET /api/fold/usage — Usage stats for CaaS.
 */
foldRouter.get('/usage', async (req: Request, res: Response) => {
  const redis = getRedis()
  if (!redis) {
    res.json({ success: true, data: { message: 'Redis not available — no usage tracking' } })
    return
  }

  try {
    const logLength = await redis.llen('caas:usage-log')
    const recent = await redis.lrange('caas:usage-log', 0, 9)
    const parsed = recent.map(r => { try { return JSON.parse(r) } catch { return null } }).filter(Boolean)

    res.json({
      success: true,
      data: {
        $id: `caas-usage-stats:${new Date().toISOString().slice(0, 10)}`,
        total_requests_logged: logLength,
        recent_requests: parsed,
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'USAGE_READ_ERROR', message: 'Failed to read usage stats. Check server logs.', status_code: 500 } })
  }
})
