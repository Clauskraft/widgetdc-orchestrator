/**
 * routes/evolution.ts — Autonomous Evolution Loop endpoints (LIN-342).
 *
 *   POST /api/evolution/run      — Trigger one OODA cycle
 *   GET  /api/evolution/status   — Current/last loop state
 *   GET  /api/evolution/history  — Last 10 executions from Redis
 */
import { Router, Request, Response } from 'express'
import { runEvolutionLoop, getEvolutionStatus, getEvolutionHistory } from '../intelligence/evolution-loop.js'
import { logger } from '../logger.js'

export const evolutionRouter = Router()

/**
 * POST /api/evolution/run — Trigger one cycle of the evolution loop.
 * Body: { focus_area?: string, dry_run?: boolean }
 */
evolutionRouter.post('/run', async (req: Request, res: Response) => {
  const { focus_area, dry_run } = req.body ?? {}

  try {
    // Return immediately with cycle_id, run asynchronously
    const status = getEvolutionStatus()
    if (status.is_running) {
      res.status(409).json({
        success: false,
        error: {
          code: 'ALREADY_RUNNING',
          message: `Evolution loop is already running (stage: ${status.current_stage})`,
          status_code: 409,
        },
      })
      return
    }

    // Fire and forget — respond with accepted
    const cyclePromise = runEvolutionLoop({
      focus_area: typeof focus_area === 'string' ? focus_area : undefined,
      dry_run: typeof dry_run === 'boolean' ? dry_run : false,
    })

    // Wait briefly for fast cycles, but don't block indefinitely
    const raceResult = await Promise.race([
      cyclePromise.then(result => ({ type: 'done' as const, result })),
      new Promise<{ type: 'timeout' }>(r => setTimeout(() => r({ type: 'timeout' }), 5000)),
    ])

    if (raceResult.type === 'done') {
      res.json({ success: true, data: raceResult.result })
    } else {
      // Still running — respond with accepted
      const currentStatus = getEvolutionStatus()
      res.status(202).json({
        success: true,
        message: 'Evolution loop started. Check /api/evolution/status for progress.',
        current_stage: currentStatus.current_stage,
      })
      // Let the promise complete in the background
      cyclePromise.catch(err => {
        logger.error({ err: String(err) }, 'Background evolution loop failed')
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err: message }, 'Evolution run endpoint failed')
    res.status(500).json({
      success: false,
      error: { code: 'EVOLUTION_ERROR', message, status_code: 500 },
    })
  }
})

/**
 * GET /api/evolution/status — Current loop state.
 */
evolutionRouter.get('/status', (_req: Request, res: Response) => {
  const status = getEvolutionStatus()
  res.json({ success: true, data: status })
})

/**
 * GET /api/evolution/history — Last N executions from Redis.
 * Query: ?limit=10
 */
evolutionRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 10, 1), 50)
    const history = await getEvolutionHistory(limit)
    res.json({ success: true, data: history, count: history.length })
  } catch (err) {
    logger.error({ err: String(err) }, 'Evolution history endpoint failed')
    res.status(500).json({
      success: false,
      error: { code: 'HISTORY_ERROR', message: String(err), status_code: 500 },
    })
  }
})
