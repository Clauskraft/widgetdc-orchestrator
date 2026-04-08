/**
 * routes/peer-eval.ts — Fleet Learning REST API
 *
 * GET  /status          — PeerEval state (eval count, task types, best practices shared)
 * GET  /fleet           — All fleet learnings by task type
 * GET  /fleet/:taskType — Specific task type learning + what-works
 * GET  /recent          — Recent evaluations
 * POST /evaluate        — Manual evaluation trigger
 * POST /analyze         — Trigger RLM fleet analysis
 */
import { Router, Request, Response } from 'express'
import {
  getPeerEvalState, getAllFleetLearnings, getFleetLearning,
  getWhatWorks, getRecentEvals, hookIntoExecution, runFleetAnalysis,
} from '../peer-eval.js'
import { logger } from '../logger.js'

export const peerEvalRouter = Router()

peerEvalRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: getPeerEvalState() })
})

peerEvalRouter.get('/fleet', (_req: Request, res: Response) => {
  const learnings = getAllFleetLearnings()
  res.json({
    success: true,
    data: learnings.map(l => ({
      taskType: l.taskType,
      totalEvals: l.totalEvals,
      avgScore: l.avgScore,
      avgCost: l.avgCost,
      avgLatency: l.avgLatency,
      bestAgent: l.bestAgent,
      bestScore: l.bestScore,
      bestPracticeCount: l.bestPractices.length,
      lastUpdated: l.lastUpdated,
    })),
    count: learnings.length,
  })
})

peerEvalRouter.get('/fleet/:taskType', async (req: Request, res: Response) => {
  const taskType = req.params.taskType
  const learning = getFleetLearning(taskType)
  if (!learning) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `No fleet learning for task type: ${taskType}`, status_code: 404 } })
    return
  }
  const whatWorks = await getWhatWorks(taskType)
  res.json({
    success: true,
    data: {
      learning,
      whatWorks,
    },
  })
})

peerEvalRouter.get('/recent', async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20
  const evals = await getRecentEvals(Math.min(limit, 100))
  res.json({ success: true, data: evals, count: evals.length })
})

peerEvalRouter.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const { agentId, taskId, taskType, success, metrics, insights } = req.body as {
      agentId: string; taskId: string; taskType: string; success: boolean
      metrics: { cost_usd?: number; latency_ms: number; quality_score?: number }
      insights?: string[]
    }
    if (!agentId || !taskId || !taskType || !metrics?.latency_ms) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Required: agentId, taskId, taskType, metrics.latency_ms', status_code: 400 } })
      return
    }
    const evalReport = await hookIntoExecution(agentId, taskId, {
      taskType, success, metrics, insights,
    })
    res.json({ success: true, data: { evalId: evalReport.id, selfScore: evalReport.selfScore, novelty: evalReport.novelty } })
  } catch (err) {
    logger.error({ error: String(err) }, 'Manual evaluation failed')
    res.status(500).json({ success: false, error: { code: 'EVAL_FAILED', message: String(err), status_code: 500 } })
  }
})

peerEvalRouter.post('/analyze', async (_req: Request, res: Response) => {
  try {
    const analysis = await runFleetAnalysis()
    res.json({ success: true, data: { analysis: analysis.slice(0, 2000) } })
  } catch (err) {
    logger.error({ error: String(err) }, 'Fleet analysis failed')
    res.status(500).json({ success: false, error: { code: 'ANALYSIS_FAILED', message: String(err), status_code: 500 } })
  }
})
