/**
 * routes/inventor.ts — Orchestrator_Inventor REST API endpoints.
 *
 * Exposes the ASI-Evolve-inspired evolution engine as a testable
 * variant alongside the existing Orchestrator.
 */
import { Router, Request, Response } from 'express'
import { broadcastMessage } from '../chat-broadcaster.js'
import {
  runInventor,
  getInventorStatus,
  getInventorNodes,
  getInventorNode,
  getBestNode,
  stopInventor,
  getExperimentHistory,
} from '../intelligence/inventor-loop.js'
import type { InventorConfig } from '../intelligence/inventor-types.js'
import { logger } from '../logger.js'

export const inventorRouter = Router()

/**
 * POST /api/inventor/run — Start (or resume) an evolution experiment.
 * Body: { config: InventorConfig, resume?: boolean }
 */
inventorRouter.post('/run', async (req: Request, res: Response) => {
  const { config, resume } = req.body as { config?: InventorConfig; resume?: boolean }

  if (!config || !config.experimentName || !config.taskDescription) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Required: config.experimentName, config.taskDescription',
        status_code: 400,
      },
    })
    return
  }

  // Check if already running
  const status = getInventorStatus()
  if (status.isRunning) {
    res.status(409).json({
      success: false,
      error: {
        code: 'ALREADY_RUNNING',
        message: `Experiment '${status.experimentName}' is already running (step ${status.currentStep}/${status.totalSteps})`,
        status_code: 409,
      },
    })
    return
  }

  // Defaults
  const fullConfig: InventorConfig = {
    experimentName: config.experimentName,
    taskDescription: config.taskDescription,
    initialArtifact: config.initialArtifact,
    sampling: {
      algorithm: config.sampling?.algorithm ?? 'ucb1',
      sampleN: config.sampling?.sampleN ?? 3,
      ucb1C: config.sampling?.ucb1C ?? 1.414,
      islands: config.sampling?.islands ?? { count: 5, migrationInterval: 10, migrationRate: 0.1 },
    },
    cognition: {
      topK: config.cognition?.topK ?? 5,
      threshold: config.cognition?.threshold ?? 0.3,
    },
    pipeline: {
      maxSteps: Math.min(config.pipeline?.maxSteps ?? 20, 100),
      maxArtifactLength: config.pipeline?.maxArtifactLength ?? 8000,
      engineerTimeoutMs: config.pipeline?.engineerTimeoutMs ?? 120000,
      numWorkers: config.pipeline?.numWorkers ?? 1,
    },
    evalScript: config.evalScript,
    model: config.model,
    chainMode: config.chainMode ?? 'sequential',
  }

  try {
    // Fire-and-forget — caller polls /status
    // BUG FIX: wrap in try/catch to log any sync errors before the async dispatch
    const runPromise = runInventor(fullConfig, resume ?? false)
    runPromise.catch(err => {
      logger.error({ err: String(err), experiment: fullConfig.experimentName }, 'Inventor run failed')
      broadcastMessage({
        from: 'Inventor',
        to: 'All',
        source: 'orchestrator',
        type: 'Message',
        message: `🔴 Inventor experiment '${fullConfig.experimentName}' failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      } as Record<string, unknown>)
    })

    res.status(202).json({
      success: true,
      data: {
        message: `Inventor experiment '${fullConfig.experimentName}' started`,
        experiment: fullConfig.experimentName,
        maxSteps: fullConfig.pipeline.maxSteps,
        sampling: fullConfig.sampling.algorithm,
        poll_url: '/api/inventor/status',
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'Inventor start failed')
    res.status(500).json({
      success: false,
      error: { code: 'INVENTOR_ERROR', message: String(err), status_code: 500 },
    })
  }
})

/**
 * GET /api/inventor/status — Current experiment status.
 */
inventorRouter.get('/status', (_req: Request, res: Response) => {
  const status = getInventorStatus()
  res.json({ success: true, data: status })
})

/**
 * GET /api/inventor/nodes — List all trial nodes.
 * Query: ?sort=score|created&limit=50&offset=0
 */
inventorRouter.get('/nodes', (req: Request, res: Response) => {
  const sort = (req.query.sort as string) ?? 'score'
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
  const offset = parseInt(req.query.offset as string) || 0

  let nodes = getInventorNodes()

  if (sort === 'created') {
    nodes = [...nodes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } else {
    nodes = [...nodes].sort((a, b) => b.score - a.score)
  }

  const total = nodes.length
  const paged = nodes.slice(offset, offset + limit)

  res.json({
    success: true,
    data: {
      nodes: paged,
      total,
      limit,
      offset,
    },
  })
})

/**
 * GET /api/inventor/node/:id — Get a specific trial node.
 */
inventorRouter.get('/node/:id', (req: Request, res: Response) => {
  const node = getInventorNode(req.params.id)
  if (!node) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Node '${req.params.id}' not found`, status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: node })
})

/**
 * GET /api/inventor/best — Get the best-scoring node.
 */
inventorRouter.get('/best', (_req: Request, res: Response) => {
  const best = getBestNode()
  if (!best) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'No nodes yet — run an experiment first', status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: best })
})

/**
 * POST /api/inventor/stop — Stop the currently running experiment.
 */
inventorRouter.post('/stop', async (_req: Request, res: Response) => {
  try {
    const result = stopInventor()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

/**
 * GET /api/inventor/history — List past experiments.
 * Query: ?limit=20
 */
inventorRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 50)
    const history = await getExperimentHistory(limit)
    res.json({ success: true, experiments: history, count: history.length })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
