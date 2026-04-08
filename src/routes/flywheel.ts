/**
 * routes/flywheel.ts — Value Flywheel REST endpoints.
 *
 * GET  /api/flywheel/metrics       — Latest flywheel report (5 pillars + compound)
 * POST /api/flywheel/metrics       — Trigger on-demand flywheel sync
 * GET  /api/flywheel/consolidation — Latest consolidation scan report
 * POST /api/flywheel/consolidation — Trigger on-demand consolidation scan
 */
import { Router, Request, Response } from 'express'
import { getFlywheelMetrics, runWeeklySync } from '../flywheel-coordinator.js'
import { getLastReport, runWeeklyConsolidation } from '../consolidation-engine.js'
import { getCostSummary, getAllCostProfiles } from '../cost-optimizer.js'
import { logger } from '../logger.js'

export const flywheelRouter = Router()

// ─── GET /metrics — Latest flywheel report ───────────────────────────────────

flywheelRouter.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const data = await getFlywheelMetrics()
    res.json({ success: true, ...data })
  } catch (err) {
    logger.warn({ err: String(err) }, '[Flywheel] GET /metrics failed')
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ─── POST /metrics — Trigger on-demand sync ─────────────────────────────────

flywheelRouter.post('/metrics', async (_req: Request, res: Response) => {
  try {
    const report = await runWeeklySync()
    res.json({ success: true, report, pillars: report.pillars })
  } catch (err) {
    logger.warn({ err: String(err) }, '[Flywheel] POST /metrics failed')
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ─── GET /consolidation — Latest consolidation report ────────────────────────

flywheelRouter.get('/consolidation', (_req: Request, res: Response) => {
  const report = getLastReport()
  if (!report) {
    return res.json({ success: true, available: false, report: null })
  }
  res.json({ success: true, available: true, report })
})

// ─── POST /consolidation — Trigger on-demand scan ────────────────────────────

flywheelRouter.post('/consolidation', async (_req: Request, res: Response) => {
  try {
    const report = await runWeeklyConsolidation()
    res.json({ success: true, report })
  } catch (err) {
    logger.warn({ err: String(err) }, '[Flywheel] POST /consolidation failed')
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ─── GET /cost-summary — Cost optimizer profiles summary ─────────────────────

flywheelRouter.get('/cost-summary', (_req: Request, res: Response) => {
  try {
    const summary = getCostSummary()
    const profiles = getAllCostProfiles()
    res.json({ success: true, summary, profiles: profiles.slice(0, 50) })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})
