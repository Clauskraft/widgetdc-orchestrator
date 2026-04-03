/**
 * routes/failures.ts — Red Queen Failure Harvester endpoints (LIN-567).
 *
 *   GET  /api/failures/summary   — Latest failure summary (cached)
 *   POST /api/failures/harvest   — Trigger manual harvest
 */
import { Router, Request, Response } from 'express'
import { runFailureHarvest, buildFailureSummary, harvestFailures } from '../failure-harvester.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

export const failuresRouter = Router()

/**
 * GET /api/failures/summary — Return latest failure summary.
 * Serves from Redis cache if available, otherwise runs fresh harvest.
 */
failuresRouter.get('/summary', async (_req: Request, res: Response) => {
  try {
    const redis = getRedis()
    if (redis) {
      const cached = await redis.get('orchestrator:failure-summary')
      if (cached) {
        try {
          res.json({ success: true, data: JSON.parse(cached), source: 'cache' })
          return
        } catch { /* corrupted cache — fall through to fresh harvest */ }
      }
    }

    // No cache — do a lightweight scan-only (no Neo4j persistence) for fast response
    // Full harvest with persistence happens via cron (every 4h) or POST /harvest
    const events = await harvestFailures(24)
    const summary = buildFailureSummary(events, 24)

    // Cache for 15 minutes so next request is instant
    if (redis) {
      await redis.set('orchestrator:failure-summary', JSON.stringify(summary), 'EX', 900).catch(() => {})
    }

    res.json({ success: true, data: summary, source: 'fresh' })
  } catch (err) {
    logger.error({ err: String(err) }, 'Failure summary endpoint failed')
    res.status(500).json({ success: false, error: { code: 'HARVEST_READ_ERROR', message: 'Failed to read failure summary. Check server logs.', status_code: 500 } })
  }
})

/**
 * POST /api/failures/harvest — Trigger manual harvest.
 * Accepts optional body: { window_hours: number }
 */
failuresRouter.post('/harvest', async (req: Request, res: Response) => {
  const raw = (req.body as { window_hours?: unknown })?.window_hours
  const windowHours = typeof raw === 'number' && raw >= 1 && raw <= 720 ? raw : 24
  try {
    const summary = await runFailureHarvest(windowHours)
    res.json({ success: true, data: summary })
  } catch (err) {
    logger.error({ err: String(err) }, 'Manual failure harvest failed')
    res.status(500).json({ success: false, error: { code: 'HARVEST_FAILED', message: 'Failure harvest failed. Check server logs.', status_code: 500 } })
  }
})
