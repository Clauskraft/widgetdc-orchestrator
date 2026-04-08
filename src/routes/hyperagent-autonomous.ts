/**
 * routes/hyperagent-autonomous.ts — Autonomous Execution Engine REST + SSE endpoints.
 *
 * Endpoints:
 *   POST /run                — Trigger an autonomous cycle (optional phase/maxTargets)
 *   GET  /status             — Current autonomous executor status
 *   GET  /cycles             — Recent cycle results (from Redis)
 *   POST /phase              — Set phase explicitly (admin override)
 *   POST /phase/advance      — Attempt automatic phase advancement
 *   GET  /phase/gate         — Check phase gate readiness
 *   GET  /issues             — All discovered issues across cycles
 *   GET  /stream             — Dedicated SSE stream for autonomous events
 */
import { Router, Request, Response } from 'express'
import {
  runAutonomousCycle,
  getAutonomousStatus,
  checkPhaseGate,
  advancePhase,
  setPhase,
  type AutonomousPhase,
} from '../hyperagent/hyperagent-autonomous.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

export const hyperagentAutoRouter = Router()

// ─── POST /run — Trigger autonomous cycle ──────────────────────────────────

hyperagentAutoRouter.post('/run', async (req: Request, res: Response) => {
  const { phase, maxTargets } = req.body as {
    phase?: AutonomousPhase
    maxTargets?: number
  }

  try {
    const result = await runAutonomousCycle(phase, maxTargets)
    res.json({
      success: true,
      cycle: {
        cycleId: result.cycleId,
        phase: result.phase,
        durationMs: result.durationMs,
        targetsAttempted: result.targetsAttempted,
        targetsCompleted: result.targetsCompleted,
        targetsFailed: result.targetsFailed,
        newIssuesDiscovered: result.newIssuesDiscovered.length,
        fitnessScoreDelta: result.fitnessScoreDelta,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = msg.includes('already running') ? 409 : 500
    logger.error({ err }, 'HyperAgent-Auto: cycle run failed')
    res.status(code).json({
      success: false,
      error: { code: 'CYCLE_RUN_FAILED', message: msg, status_code: code },
    })
  }
})

// ─── GET /status — Current status ──────────────────────────────────────────

hyperagentAutoRouter.get('/status', (_req: Request, res: Response) => {
  const status = getAutonomousStatus()
  res.json({ success: true, ...status })
})

// ─── GET /cycles — Recent cycle history ────────────────────────────────────

hyperagentAutoRouter.get('/cycles', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100)

  try {
    const redis = getRedis()
    if (!redis) {
      res.json({ success: true, cycles: [], count: 0, source: 'no-redis' })
      return
    }

    const raw = await redis.lrange('hyperagent:autonomous-cycles', 0, limit - 1)
    const cycles = raw.map((r: string) => {
      try {
        return JSON.parse(r)
      } catch {
        return null
      }
    }).filter(Boolean)

    res.json({ success: true, cycles, count: cycles.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({
      success: false,
      error: { code: 'CYCLES_FETCH_FAILED', message: msg, status_code: 500 },
    })
  }
})

// ─── POST /phase — Set phase explicitly ────────────────────────────────────

hyperagentAutoRouter.post('/phase', (req: Request, res: Response) => {
  const { phase } = req.body as { phase?: AutonomousPhase }

  const validPhases: AutonomousPhase[] = ['phase_0', 'phase_1', 'phase_2', 'phase_3']
  if (!phase || !validPhases.includes(phase)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Required: phase (one of ${validPhases.join(', ')})`,
        status_code: 400,
      },
    })
    return
  }

  setPhase(phase)
  res.json({ success: true, phase, message: `Phase set to ${phase} (admin override)` })
})

// ─── POST /phase/advance — Automatic phase advancement ─────────────────────

hyperagentAutoRouter.post('/phase/advance', (_req: Request, res: Response) => {
  const gateBefore = checkPhaseGate()
  const newPhase = advancePhase()

  res.json({
    success: true,
    advanced: gateBefore.shouldAdvance,
    currentPhase: newPhase,
    gate: gateBefore,
  })
})

// ─── GET /phase/gate — Check phase gate readiness ──────────────────────────

hyperagentAutoRouter.get('/phase/gate', (_req: Request, res: Response) => {
  const gate = checkPhaseGate()
  const status = getAutonomousStatus()

  res.json({
    success: true,
    currentPhase: status.currentPhase,
    ...gate,
    currentFitness: status.fitnessScore,
    edgeScores: status.edgeScores,
  })
})

// ─── GET /issues — All discovered issues ───────────────────────────────────

hyperagentAutoRouter.get('/issues', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200)

  try {
    const redis = getRedis()
    if (!redis) {
      res.json({ success: true, issues: [], count: 0 })
      return
    }

    // Aggregate issues from cycle history
    const raw = await redis.lrange('hyperagent:autonomous-cycles', 0, limit - 1)
    const allIssues: Array<{ cycle: string; phase: string; issue: string; discoveredAt: string }> = []

    for (const r of raw) {
      try {
        const cycle = JSON.parse(r)
        if (cycle.newIssuesDiscovered && Array.isArray(cycle.newIssuesDiscovered)) {
          for (const issue of cycle.newIssuesDiscovered) {
            allIssues.push({
              cycle: cycle.cycleId,
              phase: cycle.phase,
              issue,
              discoveredAt: cycle.completedAt,
            })
          }
        }
      } catch { /* skip malformed */ }
    }

    res.json({ success: true, issues: allIssues, count: allIssues.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({
      success: false,
      error: { code: 'ISSUES_FETCH_FAILED', message: msg, status_code: 500 },
    })
  }
})

// ─── GET /stream — Dedicated SSE stream for autonomous events ──────────────

hyperagentAutoRouter.get('/stream', (req: Request, res: Response) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()

  // Send initial status
  const status = getAutonomousStatus()
  res.write(`event: hyperagent:status\ndata: ${JSON.stringify(status)}\n\n`)

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    const current = getAutonomousStatus()
    res.write(`event: hyperagent:heartbeat\ndata: ${JSON.stringify({
      timestamp: new Date().toISOString(),
      isRunning: current.isRunning,
      currentStep: current.currentStep,
      currentTarget: current.currentTarget,
      totalCycles: current.totalCycles,
      fitnessScore: current.fitnessScore,
    })}\n\n`)
  }, 30_000)

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat)
    logger.debug('HyperAgent-Auto: SSE client disconnected')
  })
})
