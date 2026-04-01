/**
 * routes/adoption.ts — Adoption Dashboard API
 * GET  /api/adoption/metrics — Returns adoption KPIs
 * PUT  /api/adoption/metrics — Update adoption KPIs
 */
import { Router, Request, Response } from 'express'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

export const adoptionRouter = Router()

const REDIS_KEY = 'orchestrator:adoption-metrics'

interface AdoptionMetrics {
  features_done: number
  features_total: number
  features_pct: number
  milestones: Record<string, { status: string; tasks: number; done: number }>
  assistants: number
  pipelines: number
  obsidian_views: number
  generated_at: string
}

const DEFAULT_METRICS: Omit<AdoptionMetrics, 'generated_at'> = {
  features_done: 14,
  features_total: 54,
  features_pct: 25.9,
  milestones: {
    M0: { status: 'complete', tasks: 3, done: 3 },
    M1: { status: 'complete', tasks: 8, done: 8 },
    M2: { status: 'in_progress', tasks: 6, done: 6 },
    M3: { status: 'in_progress', tasks: 6, done: 0 },
    M4: { status: 'pending', tasks: 31, done: 0 },
  },
  assistants: 5,
  pipelines: 3,
  obsidian_views: 3,
}

/* ─── GET /metrics ────────────────────────────────────────────────────────── */

adoptionRouter.get('/metrics', async (_req: Request, res: Response) => {
  const redis = getRedis()

  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get(REDIS_KEY)
      if (cached) {
        res.json(JSON.parse(cached))
        return
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis read failed for adoption metrics')
    }
  }

  // Return defaults + persist to Redis
  const metrics: AdoptionMetrics = {
    ...DEFAULT_METRICS,
    generated_at: new Date().toISOString(),
  }

  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(metrics))
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis write failed for adoption metrics')
    }
  }

  res.json(metrics)
})

/* ─── PUT /metrics ────────────────────────────────────────────────────────── */

adoptionRouter.put('/metrics', async (req: Request, res: Response) => {
  const redis = getRedis()
  const body = req.body as Partial<Omit<AdoptionMetrics, 'generated_at'>>

  // Load current metrics
  let current: AdoptionMetrics = { ...DEFAULT_METRICS, generated_at: new Date().toISOString() }

  if (redis) {
    try {
      const cached = await redis.get(REDIS_KEY)
      if (cached) current = JSON.parse(cached)
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis read failed during adoption metrics update')
    }
  }

  // Merge updates
  if (typeof body.features_done === 'number') current.features_done = body.features_done
  if (typeof body.features_total === 'number') current.features_total = body.features_total
  if (typeof body.assistants === 'number') current.assistants = body.assistants
  if (typeof body.pipelines === 'number') current.pipelines = body.pipelines
  if (typeof body.obsidian_views === 'number') current.obsidian_views = body.obsidian_views
  if (body.milestones && typeof body.milestones === 'object') {
    current.milestones = { ...current.milestones, ...body.milestones }
  }

  // Recompute percentage
  current.features_pct = current.features_total > 0
    ? Math.round((current.features_done / current.features_total) * 1000) / 10
    : 0
  current.generated_at = new Date().toISOString()

  // Persist
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(current))
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis write failed for adoption metrics update')
      res.status(500).json({ success: false, error: 'Failed to persist metrics' })
      return
    }
  }

  res.json({ success: true, metrics: current })
})
