/**
 * routes/chat.ts — AgentMessage REST endpoints.
 * Uses TypeBox contract validation at API boundary.
 */
import { Router, Request, Response } from 'express'
import { broadcastMessage, getConnectionStats } from '../chat-broadcaster.js'
import { logger } from '../logger.js'
import { notifyChatMessage } from '../slack.js'
import { validate, validateMessage } from '../validation.js'
import type { AgentMessage } from '@widgetdc/contracts/orchestrator'

export const chatRouter = Router()

chatRouter.post('/message', (req: Request, res: Response) => {
  const result = validate<AgentMessage>(validateMessage, req.body)

  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid AgentMessage payload',
        details: result.errors,
        status_code: 400,
      },
    })
    return
  }

  const msg = { ...result.data, timestamp: new Date().toISOString() }
  broadcastMessage(msg)
  notifyChatMessage(msg.from, msg.to, msg.message)
  logger.info({ from: msg.from, to: msg.to, type: msg.type }, 'Chat message broadcast')
  res.json({ success: true, data: { timestamp: msg.timestamp } })
})

chatRouter.get('/ws-stats', (_req: Request, res: Response) => {
  res.json({ success: true, data: getConnectionStats() })
})
