/**
 * routes/chains.ts — Agent chain/swarm execution endpoints.
 */
import { Router, Request, Response } from 'express'
import { executeChain, getExecution, listExecutions, type ChainDefinition } from '../chain-engine.js'
import { logger } from '../logger.js'

export const chainsRouter = Router()

/**
 * POST /chains/execute — Execute an agent chain.
 */
chainsRouter.post('/execute', async (req: Request, res: Response) => {
  const body = req.body as ChainDefinition

  if (!body.name || !body.mode || !Array.isArray(body.steps) || body.steps.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Required: name, mode (sequential|parallel|loop|debate), steps[] (non-empty)',
        status_code: 400,
      },
    })
    return
  }

  // Validate steps
  for (const step of body.steps) {
    if (!step.agent_id) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Each step must have agent_id', status_code: 400 },
      })
      return
    }
    if (!step.tool_name && !step.cognitive_action) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Each step needs tool_name or cognitive_action', status_code: 400 },
      })
      return
    }
  }

  try {
    // Execute async — return immediately with execution_id
    const execution = executeChain(body)
    // Wait a short moment to get initial status
    const result = await Promise.race([
      execution,
      new Promise<null>(r => setTimeout(() => r(null), 100)),
    ])

    if (result) {
      // Chain completed quickly
      res.json({ success: true, data: result })
    } else {
      // Chain is still running — return execution_id for polling
      res.status(202).json({
        success: true,
        data: {
          message: 'Chain execution started',
          execution_id: (await execution).execution_id,
          poll_url: `/chains/status/${(await execution).execution_id}`,
        },
      })
    }
  } catch (err) {
    logger.error({ err: String(err) }, 'Chain execution failed')
    res.status(500).json({
      success: false,
      error: { code: 'CHAIN_ERROR', message: String(err), status_code: 500 },
    })
  }
})

/**
 * GET /chains/status/:id — Get chain execution status.
 */
chainsRouter.get('/status/:id', (req: Request, res: Response) => {
  const exec = getExecution(req.params.id)
  if (!exec) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Execution '${req.params.id}' not found`, status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: exec })
})

/**
 * GET /chains — List recent chain executions.
 */
chainsRouter.get('/', (_req: Request, res: Response) => {
  const executions = listExecutions()
  res.json({ success: true, data: { executions, total: executions.length } })
})
