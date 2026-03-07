/**
 * routes/cognitive.ts — Cognitive proxy endpoints to RLM Engine.
 */
import { Router, Request, Response } from 'express'
import { callCognitive, getRlmHealth, isRlmAvailable } from '../cognitive-proxy.js'
import { logger } from '../logger.js'

export const cognitiveRouter = Router()

/**
 * POST /cognitive/:action — Proxy cognitive action to RLM Engine.
 * Actions: reason, analyze, plan, learn, fold, enrich
 */
cognitiveRouter.post('/:action', async (req: Request, res: Response) => {
  const { action } = req.params
  const body = req.body as Record<string, unknown>

  if (!isRlmAvailable()) {
    res.status(503).json({
      success: false,
      error: {
        code: 'RLM_UNAVAILABLE',
        message: 'RLM Engine not configured. Set RLM_URL environment variable.',
        status_code: 503,
      },
    })
    return
  }

  if (!body.prompt && !body.message) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: prompt or message', status_code: 400 },
    })
    return
  }

  try {
    const result = await callCognitive(action, {
      prompt: (body.prompt ?? body.message) as string,
      context: body.context as Record<string, unknown> | undefined,
      agent_id: body.agent_id as string | undefined,
      depth: body.depth as number | undefined,
      mode: body.mode as string | undefined,
    }, body.timeout_ms as number | undefined)

    res.json({ success: true, data: { action, result } })
  } catch (err) {
    logger.error({ action, err: String(err) }, 'Cognitive proxy error')
    res.status(502).json({
      success: false,
      error: { code: 'RLM_ERROR', message: String(err), status_code: 502 },
    })
  }
})

/**
 * GET /cognitive/health — RLM Engine health status.
 */
cognitiveRouter.get('/health', async (_req: Request, res: Response) => {
  const health = await getRlmHealth()
  if (!health) {
    res.json({ success: true, data: { available: false, reason: 'RLM_URL not configured' } })
    return
  }
  res.json({ success: true, data: { available: true, ...health } })
})
