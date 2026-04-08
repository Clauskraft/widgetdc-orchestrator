/**
 * routes/pheromone.ts — Pheromone Layer REST API
 *
 * GET  /status    — Layer state (deposits, decays, active count)
 * GET  /sense     — Query pheromones by domain/type/tags
 * GET  /trails    — Aggregated trail summaries
 * GET  /heatmap   — Cross-domain heatmap for dashboard
 * POST /deposit   — Manual pheromone deposit (external signals)
 * POST /decay     — Trigger manual decay cycle
 */
import { Router, Request, Response } from 'express'
import {
  getPheromoneState, sense, getTrailSummary, getHeatmap,
  deposit, runPheromoneCron, onExternalSignal,
  type PheromoneType,
} from '../swarm/pheromone-layer.js'
import { logger } from '../logger.js'

export const pheromoneRouter = Router()

pheromoneRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: getPheromoneState() })
})

pheromoneRouter.get('/sense', async (req: Request, res: Response) => {
  try {
    const domain = req.query.domain as string | undefined
    const type = req.query.type as PheromoneType | undefined
    const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined
    const minStrength = req.query.min_strength ? parseFloat(req.query.min_strength as string) : undefined
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20

    const pheromones = await sense({ domain, type, tags, minStrength, limit })
    res.json({ success: true, data: pheromones, count: pheromones.length })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'SENSE_FAILED', message: String(err), status_code: 500 } })
  }
})

pheromoneRouter.get('/trails', async (req: Request, res: Response) => {
  try {
    const domain = req.query.domain as string
    if (!domain) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'domain query param required', status_code: 400 } })
      return
    }
    const summary = await getTrailSummary(domain)
    res.json({ success: true, data: summary })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TRAIL_FAILED', message: String(err), status_code: 500 } })
  }
})

pheromoneRouter.get('/heatmap', async (_req: Request, res: Response) => {
  try {
    const heatmap = await getHeatmap()
    res.json({ success: true, data: heatmap, count: heatmap.length })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'HEATMAP_FAILED', message: String(err), status_code: 500 } })
  }
})

pheromoneRouter.post('/deposit', async (req: Request, res: Response) => {
  try {
    const { source, domain, label, strength, metrics } = req.body as {
      source: string; domain: string; label: string; strength: number; metrics?: Record<string, number>
    }
    if (!source || !domain || !label || strength == null) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Required: source, domain, label, strength', status_code: 400 } })
      return
    }
    // Input bounds: strength 0-1, string lengths capped, metrics depth limited
    const clampedStrength = Math.max(0, Math.min(1, Number(strength) || 0))
    const safeSource = String(source).slice(0, 128)
    const safeDomain = String(domain).slice(0, 128)
    const safeLabel = String(label).slice(0, 256)
    const safeMetrics: Record<string, number> = {}
    if (metrics && typeof metrics === 'object') {
      for (const [k, v] of Object.entries(metrics).slice(0, 20)) {
        safeMetrics[String(k).slice(0, 64)] = Number(v) || 0
      }
    }
    await onExternalSignal(safeSource, safeDomain, safeLabel, clampedStrength, safeMetrics)
    res.json({ success: true, message: 'External pheromone deposited' })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DEPOSIT_FAILED', message: String(err), status_code: 500 } })
  }
})

pheromoneRouter.post('/decay', async (_req: Request, res: Response) => {
  try {
    const result = await runPheromoneCron()
    res.json({ success: true, data: result })
  } catch (err) {
    logger.error({ error: String(err) }, 'Manual pheromone decay failed')
    res.status(500).json({ success: false, error: { code: 'DECAY_FAILED', message: String(err), status_code: 500 } })
  }
})
