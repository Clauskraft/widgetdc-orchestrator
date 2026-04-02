/**
 * routes/competitive.ts — Competitive Phagocytosis endpoints (LIN-566).
 *
 *   GET  /api/competitive/report    — Latest gap report (cached)
 *   POST /api/competitive/crawl     — Trigger manual crawl
 *   GET  /api/competitive/targets   — List competitor targets
 */
import { Router, Request, Response } from 'express'
import { runCompetitiveCrawl, COMPETITOR_TARGETS } from '../competitive-crawler.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

export const competitiveRouter = Router()

/** Crawl mutex — prevents concurrent/rapid crawl triggers (P1 DDoS guard) */
let crawlInProgress = false
let lastCrawlAt = 0
const CRAWL_COOLDOWN_MS = 3600000 // 1 hour minimum between crawls

/**
 * GET /api/competitive/report — Latest gap report.
 */
competitiveRouter.get('/report', async (_req: Request, res: Response) => {
  try {
    const redis = getRedis()
    if (redis) {
      const cached = await redis.get('orchestrator:competitive-report')
      if (cached) {
        try {
          res.json({ success: true, data: JSON.parse(cached), source: 'cache' })
          return
        } catch { /* corrupted cache — fall through */ }
      }
    }
    res.json({ success: true, data: null, message: 'No report yet. Trigger crawl via POST /api/competitive/crawl' })
  } catch (err) {
    logger.error({ err: String(err) }, 'Competitive report endpoint failed')
    res.status(500).json({ success: false, error: { code: 'COMPETITIVE_READ_ERROR', message: 'Failed to read competitive report. Check server logs.', status_code: 500 } })
  }
})

/**
 * POST /api/competitive/crawl — Trigger manual crawl.
 */
competitiveRouter.post('/crawl', async (_req: Request, res: Response) => {
  // P1 DDoS guard: mutex + cooldown
  if (crawlInProgress) {
    res.status(429).json({
      success: false,
      error: { code: 'CRAWL_IN_PROGRESS', message: 'A crawl is already running. Try again later.', status_code: 429 },
    })
    return
  }
  const elapsed = Date.now() - lastCrawlAt
  if (elapsed < CRAWL_COOLDOWN_MS) {
    const waitMin = Math.ceil((CRAWL_COOLDOWN_MS - elapsed) / 60000)
    res.status(429).json({
      success: false,
      error: { code: 'CRAWL_COOLDOWN', message: `Cooldown active. Try again in ${waitMin} minutes.`, status_code: 429 },
    })
    return
  }

  crawlInProgress = true
  try {
    const report = await runCompetitiveCrawl()
    lastCrawlAt = Date.now()
    res.json({ success: true, data: report })
  } catch (err) {
    logger.error({ err: String(err) }, 'Manual competitive crawl failed')
    res.status(500).json({ success: false, error: { code: 'CRAWL_FAILED', message: 'Crawl failed. Check server logs.', status_code: 500 } })
  } finally {
    crawlInProgress = false
  }
})

/**
 * GET /api/competitive/targets — List configured competitor targets.
 */
competitiveRouter.get('/targets', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: COMPETITOR_TARGETS.map(t => ({
      name: t.name,
      slug: t.slug,
      url_count: t.urls.length,
    })),
  })
})
