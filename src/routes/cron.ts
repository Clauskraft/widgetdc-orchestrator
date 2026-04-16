/**
 * routes/cron.ts — Cron loop management endpoints.
 */
import { Router, Request, Response } from 'express'
import {
  registerCronJob,
  listCronJobs,
  runCronJob,
  setCronJobEnabled,
  deleteCronJob,
  getCronOptimizationReport,
} from '../cron-scheduler.js'

export const cronRouter = Router()

/**
 * GET /cron — List all cron jobs.
 */
cronRouter.get('/', (_req: Request, res: Response) => {
  const jobs = listCronJobs()
  res.json({ success: true, data: { jobs, total: jobs.length } })
})

/**
 * POST /cron — Register a new cron job.
 */
cronRouter.post('/', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>

  if (!body.id || !body.name || !body.schedule || !body.chain) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: id, name, schedule (cron expr), chain (ChainDefinition)', status_code: 400 },
    })
    return
  }

  try {
    registerCronJob({
      id: body.id as string,
      name: body.name as string,
      schedule: body.schedule as string,
      chain: body.chain as any,
      enabled: body.enabled !== false,
    })
    res.json({ success: true, data: { id: body.id, registered: true } })
  } catch (err) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_SCHEDULE', message: String(err), status_code: 400 },
    })
  }
})

/**
 * POST /cron/:id/run — Trigger a cron job immediately.
 */
cronRouter.post('/:id/run', async (req: Request, res: Response) => {
  try {
    await runCronJob(req.params.id)
    res.json({ success: true, data: { id: req.params.id, triggered: true } })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'RUN_ERROR', message: String(err), status_code: 500 },
    })
  }
})

/**
 * PATCH /cron/:id — Enable/disable a cron job.
 */
cronRouter.patch('/:id', (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled: boolean }
  const ok = setCronJobEnabled(req.params.id, enabled)
  if (!ok) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Cron job '${req.params.id}' not found`, status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: { id: req.params.id, enabled } })
})

/**
 * GET /cron/optimize — Chain optimizer: per-job mode recommendations.
 */
cronRouter.get('/optimize', (_req: Request, res: Response) => {
  const report = getCronOptimizationReport()
  const actionable = report.filter(r => r.recommendation !== 'keep')
  res.json({
    success: true,
    data: {
      recommendations: report,
      actionable_count: actionable.length,
      total_estimated_saving_ms: actionable.reduce((s, r) => s + r.estimatedSavingMs, 0),
    },
  })
})

/**
 * DELETE /cron/:id — Delete a cron job.
 */
cronRouter.delete('/:id', (req: Request, res: Response) => {
  const deleted = deleteCronJob(req.params.id)
  if (!deleted) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Cron job '${req.params.id}' not found`, status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: { id: req.params.id, deleted: true } })
})
