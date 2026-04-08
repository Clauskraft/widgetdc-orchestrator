/**
 * routes/benchmark.ts — Benchmark REST API for Inventor vs. research baselines.
 *
 * GET  /api/benchmark/tasks                   — List all benchmark task definitions
 * GET  /api/benchmark/tasks/:taskId           — Single task definition
 * POST /api/benchmark/run                     — Start a benchmark run
 * GET  /api/benchmark/runs                    — List runs (optional ?taskId=)
 * GET  /api/benchmark/runs/:runId             — Single run status + score history
 * POST /api/benchmark/runs/:runId/sync        — Sync run with current Inventor state
 * POST /api/benchmark/ablation                — Launch 4-strategy ablation study
 * GET  /api/benchmark/ablation/:taskId/report — Ablation comparison report
 */
import { Router, Request, Response } from 'express'
import {
  listBenchmarkTasks,
  getBenchmarkTask,
  listBenchmarkRuns,
  getBenchmarkRun,
  startBenchmarkRun,
  startAblationStudy,
  computeAblationReport,
  syncRunWithInventorStatus,
} from '../benchmark-runner.js'
import { logger } from '../logger.js'
import type { SamplingAlgorithm } from '../inventor-types.js'

export const benchmarkRouter = Router()

// ─── GET /tasks ───────────────────────────────────────────────────────────────

benchmarkRouter.get('/tasks', (_req: Request, res: Response) => {
  const tasks = listBenchmarkTasks()
  res.json({ success: true, tasks })
})

// ─── GET /tasks/:taskId ───────────────────────────────────────────────────────

benchmarkRouter.get('/tasks/:taskId', (req: Request, res: Response) => {
  const task = getBenchmarkTask(req.params.taskId)
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' })
  res.json({ success: true, task })
})

// ─── GET /runs ────────────────────────────────────────────────────────────────

benchmarkRouter.get('/runs', (req: Request, res: Response) => {
  const taskId = req.query.taskId as string | undefined
  const runs = listBenchmarkRuns(taskId)
  res.json({ success: true, runs, total: runs.length })
})

// ─── GET /runs/:runId ─────────────────────────────────────────────────────────

benchmarkRouter.get('/runs/:runId', (req: Request, res: Response) => {
  const run = getBenchmarkRun(req.params.runId)
  if (!run) return res.status(404).json({ success: false, error: 'Run not found' })
  res.json({ success: true, run })
})

// ─── POST /run ────────────────────────────────────────────────────────────────

const VALID_STRATEGIES: SamplingAlgorithm[] = ['ucb1', 'greedy', 'random', 'island']

benchmarkRouter.post('/run', async (req: Request, res: Response) => {
  const { taskId, strategy, maxRounds } = req.body ?? {}

  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ success: false, error: 'taskId is required' })
  }
  if (!strategy || !VALID_STRATEGIES.includes(strategy as SamplingAlgorithm)) {
    return res.status(400).json({
      success: false,
      error: `strategy must be one of: ${VALID_STRATEGIES.join(', ')}`,
    })
  }
  if (!getBenchmarkTask(taskId)) {
    return res.status(404).json({ success: false, error: `Unknown task: ${taskId}` })
  }

  try {
    const run = await startBenchmarkRun(
      taskId,
      strategy as SamplingAlgorithm,
      maxRounds ?? undefined,
    )
    logger.info({ runId: run.runId, taskId, strategy }, '[Benchmark] Run started')
    res.status(202).json({ success: true, run })
  } catch (err) {
    logger.error({ err: String(err), taskId, strategy }, '[Benchmark] Failed to start run')
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ─── POST /runs/:runId/sync ───────────────────────────────────────────────────

benchmarkRouter.post('/runs/:runId/sync', async (req: Request, res: Response) => {
  const run = getBenchmarkRun(req.params.runId)
  if (!run) return res.status(404).json({ success: false, error: 'Run not found' })

  const { inventorNodes, isRunning } = req.body ?? {}

  if (!Array.isArray(inventorNodes)) {
    return res.status(400).json({ success: false, error: 'inventorNodes must be an array' })
  }

  syncRunWithInventorStatus(req.params.runId, inventorNodes, Boolean(isRunning))
  const updated = getBenchmarkRun(req.params.runId)
  res.json({ success: true, run: updated })
})

// ─── POST /ablation ───────────────────────────────────────────────────────────

benchmarkRouter.post('/ablation', async (req: Request, res: Response) => {
  const { taskId, maxRoundsPerStrategy } = req.body ?? {}

  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ success: false, error: 'taskId is required' })
  }
  if (!getBenchmarkTask(taskId)) {
    return res.status(404).json({ success: false, error: `Unknown task: ${taskId}` })
  }

  try {
    const result = await startAblationStudy(
      taskId,
      maxRoundsPerStrategy ?? 20,
    )
    logger.info({ ablationId: result.ablationId, taskId }, '[Benchmark] Ablation study started')
    res.status(202).json({ success: true, ...result })
  } catch (err) {
    logger.error({ err: String(err), taskId }, '[Benchmark] Failed to start ablation')
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ─── GET /ablation/:taskId/report ─────────────────────────────────────────────

benchmarkRouter.get('/ablation/:taskId/report', (req: Request, res: Response) => {
  const task = getBenchmarkTask(req.params.taskId)
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' })

  const report = computeAblationReport(req.params.taskId)
  if (!report) {
    return res.json({
      success: true,
      available: false,
      message: 'Ablation report not yet available — need ≥2 completed runs for this task',
    })
  }

  res.json({ success: true, available: true, report })
})
