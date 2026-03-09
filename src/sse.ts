/**
 * sse.ts — Server-Sent Events for real-time dashboard updates.
 * Replaces polling with push-based event stream.
 */
import type { Request, Response } from 'express'
import { logger } from './logger.js'

interface SSEClient {
  id: string
  res: Response
  connectedAt: Date
}

const clients: SSEClient[] = []

export function handleSSE(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const clientId = `sse-${Date.now().toString(36)}`
  const client: SSEClient = { id: clientId, res, connectedAt: new Date() }
  clients.push(client)

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ id: clientId })}\n\n`)

  // Keep alive every 30s
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n')
  }, 30000)

  req.on('close', () => {
    clearInterval(keepAlive)
    const idx = clients.indexOf(client)
    if (idx >= 0) clients.splice(idx, 1)
    logger.debug({ clientId }, 'SSE client disconnected')
  })
}

export function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].res.write(payload)
    } catch {
      clients.splice(i, 1)
    }
  }
}

export function getSSEClientCount(): number {
  return clients.length
}
