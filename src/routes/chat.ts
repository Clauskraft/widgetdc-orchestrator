/**
 * routes/chat.ts — AgentMessage REST endpoints.
 */
import { Router, Request, Response } from 'express'
import { broadcastMessage, getConnectionStats } from '../chat-broadcaster.js'
import { logger } from '../logger.js'
import { notifyChatMessage } from '../slack.js'

export const chatRouter = Router()

chatRouter.post('/message', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>

  if (!body.from || !body.to || !body.source || !body.type || !body.message) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: from, to, source, type, message', status_code: 400 },
    })
    return
  }

  const msg = { ...body, timestamp: new Date().toISOString() } as Parameters<typeof broadcastMessage>[0]
  broadcastMessage(msg)
  notifyChatMessage(body.from as string, body.to as string, body.message as string)
  logger.info({ from: msg.from, to: msg.to, type: msg.type }, 'Chat message broadcast')
  res.json({ success: true, data: { timestamp: msg.timestamp } })
})

chatRouter.get('/ws-stats', (_req: Request, res: Response) => {
  res.json({ success: true, data: getConnectionStats() })
})
